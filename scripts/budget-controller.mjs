#!/usr/bin/env node
/**
 * budget-controller.mjs — runtime token-budget enforcement + model-tier downgrade + fallback
 *                         chains (FRW-BL-053)
 *
 * COMPLEMENTS the pre-spawn cost gate (a STATIC, before-spawn dollar estimate) and FRW-BL-031
 * (deterministic per-agent model selection). This module is the RUNTIME counterpart: once a
 * teammate is live and burning tokens, it answers three operational questions that a static
 * gate cannot:
 *
 *   1. BUDGET ENFORCEMENT (Shannon dual-level budget). Each card AND each teammate gets a token
 *      budget. `createBudgetTracker` accumulates real token spend per scope id and reports
 *      remaining / within-budget, so a runaway card or a single greedy teammate is bounded even
 *      when the project-level dollar ceiling has room.
 *
 *   2. TIER DOWNGRADE. As a scope's remaining budget depletes, `selectTier` walks the model down
 *      the DOWNGRADE order opus -> sonnet -> haiku. This is the REVERSE of hierarchy-config's
 *      escalation `tierOrder: ['haiku','sonnet','opus']` (which bumps UP on repeated failure):
 *      here we step DOWN to stretch a shrinking budget. We never upgrade above the base tier and
 *      clamp at haiku.
 *
 *   3. FALLBACK CHAINS (claude-code-router). On a retryable provider error — 529/overloaded,
 *      429/rate-limit, or a transient network blip — `classifyError` + `nextFallback` step the
 *      request down a per-tier fallback chain instead of hard-failing; a fatal error escalates.
 *
 * Plus a record-once token LEDGER (`createTokenLedger`) so each card's usage is recorded EXACTLY
 * once (idempotent) — re-recording the same cardId is a no-op, satisfying "token usage recorded
 * exactly once per card".
 *
 * Tier names are mirrored LOCALLY here (TIER_ORDER) on purpose — hierarchy-config.ts is the
 * source of truth for the names, but this module must not edit or import it (worktree has no TS
 * toolchain). Pure Node, NO external deps. Exported functions are pure / closure-based so they
 * unit-test without I/O. Self-test: scripts/budget-controller.test.mjs.
 */

/**
 * DOWNGRADE order: highest-capability first, lowest last. The REVERSE of hierarchy-config.ts's
 * escalation tierOrder (['haiku','sonnet','opus']). selectTier / nextFallback walk this array
 * toward the end ('haiku') as budget depletes or retryable errors recur.
 * @type {readonly ['opus','sonnet','haiku']}
 */
export const TIER_ORDER = Object.freeze(['opus', 'sonnet', 'haiku']);

/** Lowest tier — the clamp floor for every downgrade / fallback step. */
const FLOOR_TIER = TIER_ORDER[TIER_ORDER.length - 1];

/**
 * Module defaults. Budgets are token counts (per card / per teammate). Thresholds are the
 * FRACTION-REMAINING boundaries selectTier uses: at/above `oneStepDown` no downgrade; below it,
 * one step down; below `toFloor`, jump straight to haiku.
 */
export const DEFAULTS = Object.freeze({
  perCardTokens: 200_000,
  perTeammateTokens: 1_000_000,
  thresholds: Object.freeze({
    oneStepDown: 0.5, // < 0.5 remaining -> one step down toward haiku
    toFloor: 0.2,     // < 0.2 remaining -> clamp to haiku
  }),
});

/** Index of a tier in TIER_ORDER, or -1 if unknown. */
function tierIndex(tier) {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Step a tier DOWN toward 'haiku' by `steps` (default 1), clamped at the floor. Unknown tiers are
 * treated as already at the floor (defensive: never crash on a typo, just hand back haiku).
 * @param {string} tier
 * @param {number} [steps]
 * @returns {string}
 */
function stepDown(tier, steps = 1) {
  const i = tierIndex(tier);
  if (i < 0) return FLOOR_TIER;
  const next = Math.min(i + steps, TIER_ORDER.length - 1);
  return TIER_ORDER[next];
}

/**
 * Per-scope token accumulator enforcing per-card AND per-teammate budgets (Shannon dual-level).
 * A "scope id" is whatever the caller keys spend by — a cardId for card budgets, a teammate name
 * for teammate budgets; the tracker is agnostic and just sums per id. `withinBudget` flips at the
 * limit BOUNDARY: spend strictly LESS than the limit is within budget; spend EQUAL to or above the
 * limit is NOT (the limit is the cap — reaching it is over).
 *
 * @param {{perCardTokens?: number, perTeammateTokens?: number}} [opts] retained on the tracker as
 *        `.perCardTokens` / `.perTeammateTokens` for callers that want the configured caps.
 * @returns {{
 *   record: (scopeId: string, tokens: number) => number,
 *   spent: (scopeId: string) => number,
 *   remaining: (scopeId: string, limit: number) => number,
 *   withinBudget: (scopeId: string, limit: number) => boolean,
 *   perCardTokens: number,
 *   perTeammateTokens: number,
 * }}
 */
export function createBudgetTracker({ perCardTokens = DEFAULTS.perCardTokens, perTeammateTokens = DEFAULTS.perTeammateTokens } = {}) {
  /** scopeId -> cumulative tokens */
  const spend = new Map();
  return {
    perCardTokens,
    perTeammateTokens,
    /** Add `tokens` (negative/NaN treated as 0) to a scope's running total; returns the new total. */
    record(scopeId, tokens) {
      const n = Number(tokens);
      const add = Number.isFinite(n) && n > 0 ? n : 0;
      const total = (spend.get(scopeId) || 0) + add;
      spend.set(scopeId, total);
      return total;
    },
    /** Cumulative tokens recorded for a scope (0 if never recorded). */
    spent(scopeId) {
      return spend.get(scopeId) || 0;
    },
    /** Tokens left under `limit` for a scope; never negative (clamped at 0 once over budget). */
    remaining(scopeId, limit) {
      return Math.max(0, limit - (spend.get(scopeId) || 0));
    },
    /** True iff this scope's spend is STRICTLY below `limit`. At/over the limit -> false. */
    withinBudget(scopeId, limit) {
      return (spend.get(scopeId) || 0) < limit;
    },
  };
}

/**
 * Choose the runtime model tier given how much budget is left. Walks `baseTier` DOWN toward haiku
 * as `fractionRemaining` shrinks past the thresholds; NEVER upgrades above baseTier; clamps at
 * haiku. With a full/near-full budget it returns baseTier unchanged.
 *
 * Boundaries (default thresholds): remaining >= 0.5 -> baseTier; 0.2 <= remaining < 0.5 -> one
 * step down; remaining < 0.2 -> haiku. (Strictly-less, matching "< 0.5" / "< 0.2" in the ISC.)
 *
 * @param {{baseTier?: string, fractionRemaining?: number, thresholds?: {oneStepDown?: number, toFloor?: number}}} [opts]
 * @returns {string} a tier in TIER_ORDER, never higher than baseTier
 */
export function selectTier({ baseTier = 'sonnet', fractionRemaining = 1, thresholds = DEFAULTS.thresholds } = {}) {
  const { oneStepDown = DEFAULTS.thresholds.oneStepDown, toFloor = DEFAULTS.thresholds.toFloor } = thresholds || {};

  // Unknown base tier -> treat as the floor; nothing to downgrade.
  const baseIdx = tierIndex(baseTier);
  if (baseIdx < 0) return FLOOR_TIER;

  const frac = Number(fractionRemaining);
  const f = Number.isFinite(frac) ? frac : 1;

  let chosen;
  if (f < toFloor) {
    chosen = FLOOR_TIER;            // deeply depleted -> cheapest tier
  } else if (f < oneStepDown) {
    chosen = stepDown(baseTier, 1); // moderately depleted -> one step down
  } else {
    chosen = baseTier;             // healthy -> stay on base tier
  }

  // Guard: NEVER upgrade above baseTier (e.g. if a caller passed an already-low base). The chosen
  // tier's index must be >= baseIdx (further down or equal in TIER_ORDER).
  const chosenIdx = tierIndex(chosen);
  return chosenIdx < baseIdx ? baseTier : chosen;
}

/**
 * Classify a provider error (Error object, response-ish object, or raw string) into one of four
 * actionable classes. Inspects an explicit numeric `status`/`statusCode` first, then falls back to
 * matching the message text. Precedence is deliberate: 529/overloaded is checked before generic
 * 429/rate-limit, both before transient network codes, else 'fatal'.
 *
 *   'overloaded_529' — HTTP 529 or "overloaded" (Anthropic server overload; retryable, back off)
 *   'rate_limit'     — HTTP 429 or "rate limit" / "too many requests" (retryable, back off)
 *   'transient'      — ETIMEDOUT / ECONNRESET / ECONNREFUSED / EAI_AGAIN / "timeout" (retryable)
 *   'fatal'          — anything else (4xx auth/validation, unknown) — do NOT blindly retry
 *
 * @param {unknown} errOrText
 * @returns {'overloaded_529'|'rate_limit'|'transient'|'fatal'}
 */
export function classifyError(errOrText) {
  if (errOrText == null) return 'fatal';

  // Pull an explicit status code if present on an object.
  let status = null;
  if (typeof errOrText === 'object') {
    const cand = errOrText.status ?? errOrText.statusCode ?? errOrText.code;
    if (typeof cand === 'number') status = cand;
  }

  const text = String(
    typeof errOrText === 'string'
      ? errOrText
      : (errOrText && (errOrText.message || errOrText.code || errOrText.toString?.())) || '',
  );
  const lower = text.toLowerCase();

  // 529 / overloaded first (more specific than the generic 429 bucket).
  if (status === 529 || /\b529\b/.test(text) || lower.includes('overloaded')) {
    return 'overloaded_529';
  }
  // 429 / rate limit.
  if (status === 429 || /\b429\b/.test(text) || lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('too many requests')) {
    return 'rate_limit';
  }
  // Transient network errors.
  if (
    /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|ENOTFOUND)\b/i.test(text) ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('socket hang up')
  ) {
    return 'transient';
  }
  return 'fatal';
}

/**
 * Compute the next tier in the FALLBACK chain for a classified error.
 *
 * For retryable classes (overloaded_529 / rate_limit / transient): step the current tier DOWN one
 * notch toward haiku. At the floor (haiku) there is nowhere lower to go, so we STAY on haiku and
 * SIGNAL escalation (the loop/quality gate should surface it rather than spin). For 'fatal':
 * there is no useful fallback tier — escalate immediately.
 *
 * @param {string} currentTier a tier in TIER_ORDER
 * @param {'overloaded_529'|'rate_limit'|'transient'|'fatal'} errorClass
 * @returns {{ tier: string|null, retry: boolean, escalate: boolean, reason: string }}
 *   - `tier`: the tier to retry on (null when not retrying / fatal)
 *   - `retry`: whether the caller should reissue the request
 *   - `escalate`: whether this should be surfaced (fatal, or exhausted at haiku)
 */
export function nextFallback(currentTier, errorClass) {
  const retryable = errorClass === 'overloaded_529' || errorClass === 'rate_limit' || errorClass === 'transient';

  if (!retryable) {
    // 'fatal' (or anything unrecognized) -> no fallback tier, escalate.
    return { tier: null, retry: false, escalate: true, reason: `fatal/non-retryable error class "${errorClass}" — escalate` };
  }

  const idx = tierIndex(currentTier);
  // Unknown current tier -> drop to floor and retry there once.
  if (idx < 0) {
    return { tier: FLOOR_TIER, retry: true, escalate: false, reason: `unknown tier "${currentTier}" — fall back to ${FLOOR_TIER}` };
  }

  // Already at the floor: nowhere lower; retrying same tier risks a hot loop -> escalate.
  if (idx >= TIER_ORDER.length - 1) {
    return { tier: FLOOR_TIER, retry: false, escalate: true, reason: `at floor tier "${FLOOR_TIER}" — fallback chain exhausted, escalate` };
  }

  const next = stepDown(currentTier, 1);
  return { tier: next, retry: true, escalate: false, reason: `${errorClass} on ${currentTier} -> fall back to ${next}` };
}

/**
 * Record-once token ledger. Guarantees a card's usage is recorded EXACTLY once: the first
 * `record(cardId, usage)` stores it and returns `{ recorded: true, duplicate: false }`; any later
 * record of the SAME cardId is a NO-OP and returns `{ recorded: false, duplicate: true }` (the
 * stored value and running total are unchanged). This satisfies "token usage recorded exactly once
 * per card" even if the stop hook / loop fires twice for the same card.
 *
 * @returns {{
 *   record: (cardId: string, usage: number) => { recorded: boolean, duplicate: boolean, value: number },
 *   get: (cardId: string) => number|undefined,
 *   total: () => number,
 *   has: (cardId: string) => boolean,
 *   entries: () => Array<[string, number]>,
 * }}
 */
export function createTokenLedger() {
  /** cardId -> tokens (set once, never mutated). */
  const ledger = new Map();
  let runningTotal = 0;

  return {
    /** Idempotent per cardId. `usage` coerced to a non-negative finite number (else 0). */
    record(cardId, usage) {
      if (ledger.has(cardId)) {
        // Duplicate: no-op. Return the already-stored value so callers can read it.
        return { recorded: false, duplicate: true, value: ledger.get(cardId) };
      }
      const n = Number(usage);
      const value = Number.isFinite(n) && n > 0 ? n : 0;
      ledger.set(cardId, value);
      runningTotal += value;
      return { recorded: true, duplicate: false, value };
    },
    /** Stored tokens for a card, or undefined if never recorded. */
    get(cardId) {
      return ledger.get(cardId);
    },
    /** Sum of all recorded (deduped) card usage. */
    total() {
      return runningTotal;
    },
    /** Whether a card has already been recorded. */
    has(cardId) {
      return ledger.has(cardId);
    },
    /** Snapshot of [cardId, tokens] pairs. */
    entries() {
      return [...ledger.entries()];
    },
  };
}
