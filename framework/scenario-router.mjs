#!/usr/bin/env node
/**
 * scenario-router.mjs — request-aware / scenario model routing + a user-overridable router hook
 *                       (FRW-BL-059)
 *
 * COMPLEMENTS the existing model-selection machinery rather than replacing it:
 *
 *   - hierarchy-config.ts MODEL_TIERS is the SOURCE OF TRUTH for the tier names
 *     (haiku < sonnet < opus) and the per-role default tier. We do NOT import or edit it (the
 *     worktree has no TS toolchain); the tier order is mirrored LOCALLY here as TIER_ORDER.
 *   - FRW-BL-031 picks a DETERMINISTIC per-agent base tier from the persona/role. That base tier is
 *     the `baseTier` INPUT to this module.
 *   - FRW-BL-053 (budget-controller.mjs) walks a tier DOWN as a budget depletes (opus->haiku).
 *
 * This module sits BETWEEN those two: given a deterministic `baseTier`, it adjusts the tier UP/DOWN
 * based on REQUEST-AWARE signals that the static per-role default cannot see:
 *
 *   1. SCENARIO SIGNALS classified from the card itself — 'background' (low-stakes / async work),
 *      'think' (extended reasoning needed), 'long_context' (large inputs / many files). Inspired by
 *      claude-code-router's scenario routing (background / think / longContext).
 *   2. TOKEN-COUNT thresholds — a request whose estimated token count crosses a high boundary needs
 *      a model that can actually hold the context, regardless of persona tier.
 *   3. A USER-OVERRIDABLE HOOK — an optional function the user supplies that WINS over all rule-based
 *      logic when it returns a valid tier (per card / per agent control).
 *
 * DEFAULT-UNCHANGED GUARANTEE (ISC-3): with NO scenario signals, a token count BELOW every threshold
 * and NO override, routeTier returns `baseTier` EXACTLY. We never silently mutate the deterministic
 * default — scenario routing only ever fires when there is a concrete reason to.
 *
 * Pure Node ESM, NO external deps. Exported functions are pure (no I/O, no globals) so they
 * unit-test in isolation. Self-test: framework/scenario-router.test.mjs.
 */

/**
 * Tier order LOW -> HIGH, mirroring hierarchy-config.ts MODEL_TIERS escalation `tierOrder`
 * (['haiku','sonnet','opus']). Index = capability rank: higher index = more capable / costlier.
 * Mirrored locally on purpose (must not import the TS config from a worktree without tsc).
 * @type {readonly ['haiku','sonnet','opus']}
 */
export const TIER_ORDER = Object.freeze(['haiku', 'sonnet', 'opus']);

/** Lowest / highest tiers — convenience clamps. */
const FLOOR_TIER = TIER_ORDER[0];
const CEIL_TIER = TIER_ORDER[TIER_ORDER.length - 1];

/**
 * The scenario signals this router understands. Stable string constants so callers and the override
 * hook can reference them without hard-coding literals.
 *
 *   background   — low-stakes / async / non-interactive work; SAFE to bias toward a cheaper tier.
 *   think        — extended reasoning / hard problem; bias toward a MORE capable tier.
 *   long_context — large inputs, many files, big diffs; ensure a tier that can hold the context.
 *
 * @type {{ readonly BACKGROUND: 'background', readonly THINK: 'think', readonly LONG_CONTEXT: 'long_context' }}
 */
export const SCENARIO_SIGNALS = Object.freeze({
  BACKGROUND: 'background',
  THINK: 'think',
  LONG_CONTEXT: 'long_context',
});

/** All recognised signal VALUES, frozen, for validation / iteration. */
const ALL_SIGNALS = Object.freeze(Object.values(SCENARIO_SIGNALS));

/**
 * Keyword tables used by classifyScenario to detect signals from free-text card fields.
 *
 * MATCHING STRATEGY: each entry is matched as a WHOLE PHRASE against the lower-cased card text
 * using the `matchPhrase` helper (word-boundary / anchored). Only unambiguous, multi-word phrasings
 * are listed — bare common words like "think", "background", "massive" are deliberately ABSENT
 * because they appear in ordinary card prose ("I think this", "background color", "massive impact")
 * and would silently mis-route. The explicit `card.scenario` field is the escape hatch for any
 * signal that cannot be expressed unambiguously in prose.
 *
 * RULE: when in doubt, leave a keyword OUT. False negatives (miss a signal) are far safer than
 * false positives (silently escalate or downgrade a normal card).
 */
const SIGNAL_KEYWORDS = Object.freeze({
  // background: ONLY explicit async-job / background-task phrasings, not bare "background" which
  // is ubiquitous in UI prose ("background color", "background image", etc.).
  [SCENARIO_SIGNALS.BACKGROUND]: Object.freeze([
    'background job', 'background task', 'background process', 'background worker',
    'async job', 'async task', 'async process',
    'asynchronous job', 'asynchronous task',
    'non-interactive', 'noninteractive',
    'fire and forget', 'fire-and-forget',
    'low priority task', 'low-priority task',
    'batch job', 'batch task',
  ]),
  // think: ONLY multi-word reasoning phrasings; bare "think" / "thinking" match every sentence
  // of the form "I think this is good" or "rethink the design".
  [SCENARIO_SIGNALS.THINK]: Object.freeze([
    'extended reasoning', 'deep reasoning', 'reason carefully',
    'step by step', 'step-by-step',
    'chain of thought', 'chain-of-thought',
    'complex reasoning', 'reasoning-heavy',
    'analyze deeply', 'deep analysis',
    'hard problem', 'difficult reasoning',
  ]),
  // long_context: multi-word phrases that unambiguously describe large-input scenarios.
  // "massive" and "huge input" / "large input" are dropped — they appear in hyperbole like
  // "massive impact" / "massive user base" and don't indicate context size.
  [SCENARIO_SIGNALS.LONG_CONTEXT]: Object.freeze([
    'long context', 'long-context',
    'large context', 'large context window',
    'many files', 'multiple files',
    'whole repo', 'entire repo',
    'whole codebase', 'entire codebase',
    'large diff', 'big diff',
    'large file set', 'large number of files',
  ]),
});

/**
 * Module defaults: token-count thresholds (in tokens) and the per-signal behaviour knobs. Exported
 * so callers can read or shallow-override them; `routeTier` accepts a `thresholds` override too.
 *
 *   tokenHigh — at/above this estimated token count we ESCALATE toward opus (a true long-context
 *               request); this is the request-aware analogue of the 'long_context' signal.
 *   tokenLow  — below this we consider the request "small"; combined with a 'background' signal it
 *               is safe to step DOWN one tier to save cost.
 */
export const DEFAULTS = Object.freeze({
  thresholds: Object.freeze({
    tokenHigh: 120_000, // >= this -> escalate toward opus (long context)
    tokenLow: 16_000,   // < this -> small request; background may downgrade
  }),
});

/** Index of a tier in TIER_ORDER (LOW->HIGH), or -1 if unknown. */
function tierIndex(tier) {
  return TIER_ORDER.indexOf(tier);
}

/** True iff `tier` is one of the recognised tier names. */
function isValidTier(tier) {
  return typeof tier === 'string' && tierIndex(tier) >= 0;
}

/**
 * Step a tier UP toward opus by `steps` (default 1), clamped at the ceiling (opus). Unknown tiers
 * are returned unchanged (defensive: never invent a tier for a typo here — the public entry points
 * validate first).
 * @param {string} tier
 * @param {number} [steps]
 * @returns {string}
 */
function stepUp(tier, steps = 1) {
  const i = tierIndex(tier);
  if (i < 0) return tier;
  return TIER_ORDER[Math.min(i + steps, TIER_ORDER.length - 1)];
}

/**
 * Step a tier DOWN toward haiku by `steps` (default 1), clamped at the floor (haiku). Unknown tiers
 * returned unchanged.
 * @param {string} tier
 * @param {number} [steps]
 * @returns {string}
 */
function stepDown(tier, steps = 1) {
  const i = tierIndex(tier);
  if (i < 0) return tier;
  return TIER_ORDER[Math.max(i - steps, 0)];
}

/** Return whichever of two tiers is higher (more capable). Unknown tiers lose to a valid one. */
function maxTier(a, b) {
  const ia = tierIndex(a);
  const ib = tierIndex(b);
  if (ia < 0) return b;
  if (ib < 0) return a;
  return ia >= ib ? a : b;
}

/** Collect the searchable free-text of a card into one lower-cased string. */
function cardText(card) {
  if (!card || typeof card !== 'object') return '';
  const parts = [
    card.title,
    card.description,
    card.technicalNotes,
    card.notes,
    card.summary,
  ];
  return parts.filter((p) => typeof p === 'string').join('\n').toLowerCase();
}

/**
 * True iff `phrase` appears in `text` at a WORD BOUNDARY on both sides. This prevents bare common
 * words from matching as part of larger words or inside unrelated phrases:
 *   "background job" matches in "run as a background job"  ✓
 *   "background" alone would also match "background color" — but we don't put bare words in tables.
 *
 * For multi-word phrases the boundary is checked at the START of the first word and the END of the
 * last word only (the interior is a literal phrase match). `\b` is word-boundary in JS regex: it
 * fires between a \w char and a \W char (or start/end of string), which is sufficient for all
 * SIGNAL_KEYWORDS entries (they begin and end with alphanumeric chars).
 *
 * @param {string} text  lower-cased haystack
 * @param {string} phrase  lower-cased needle (from SIGNAL_KEYWORDS)
 * @returns {boolean}
 */
function matchPhrase(text, phrase) {
  // Escape regex metacharacters in the phrase (hyphens, dots, etc.).
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b at start and end anchors to word boundaries.
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * Detect scenario signals from a card. Two sources, UNION-ed and de-duplicated:
 *
 *   1. An EXPLICIT `card.scenario` field — a string or array of strings. Only recognised signal
 *      names (see SCENARIO_SIGNALS) are kept; anything else is ignored (a typo never invents a
 *      signal). This is the precise, machine-set path.
 *   2. KEYWORD matching over the card's free text (title / description / technicalNotes / notes /
 *      summary) against SIGNAL_KEYWORDS. This is the best-effort, human-authored path.
 *
 * Returns signals in canonical TIER-relevant order (background, think, long_context) so output is
 * deterministic regardless of detection source. An empty array means "no scenario detected" — which
 * is exactly what drives the default-unchanged guarantee in routeTier.
 *
 * @param {{title?:string, description?:string, technicalNotes?:string, notes?:string, summary?:string,
 *          scenario?: string|string[]}} [card]
 * @returns {string[]} subset of SCENARIO_SIGNALS values, de-duplicated, canonical order
 */
export function classifyScenario(card) {
  const found = new Set();

  // 1) Explicit, machine-set scenario field (string or array). Validate against known signals.
  if (card && card.scenario != null) {
    const explicit = Array.isArray(card.scenario) ? card.scenario : [card.scenario];
    for (const s of explicit) {
      if (typeof s === 'string') {
        const norm = s.trim().toLowerCase();
        if (ALL_SIGNALS.includes(norm)) found.add(norm);
      }
    }
  }

  // 2) Keyword detection over the card's free text. Uses matchPhrase() (word-boundary anchored)
  //    to prevent partial / mid-word hits (e.g. "background color" must NOT trip the background
  //    signal; only "background job" / "background task" etc. should).
  const text = cardText(card);
  if (text) {
    for (const signal of ALL_SIGNALS) {
      if (found.has(signal)) continue;
      const kws = SIGNAL_KEYWORDS[signal];
      if (kws.some((kw) => matchPhrase(text, kw))) found.add(signal);
    }
  }

  // Canonical order = declaration order in SCENARIO_SIGNALS.
  return ALL_SIGNALS.filter((s) => found.has(s));
}

/**
 * Resolve a model tier for a single request, REQUEST-AWARE.
 *
 * PRECEDENCE (highest first):
 *   1. `override` — if a function is supplied, it WINS. It is called with the full context
 *      `{ baseTier, scenario, tokenCount, thresholds }`; if it returns a VALID tier name that tier
 *      is used verbatim (per card / per agent control). If it throws, returns undefined/null, or
 *      returns an unrecognised tier, we IGNORE it and fall back to the rule-based path (never crash).
 *   2. RULE-BASED scenario + token logic, applied to `baseTier`:
 *        - long_context signal OR tokenCount >= thresholds.tokenHigh -> ensure AT LEAST 'sonnet' and
 *          escalate ONE step toward opus (a request that can't fit a small model must move up).
 *        - think signal -> escalate ONE step toward opus (extended reasoning wants a deeper model).
 *        - background signal AND a SMALL request (tokenCount < thresholds.tokenLow) AND no escalation
 *          reason -> step DOWN one tier (cheap, low-stakes async work). Background NEVER downgrades a
 *          request that long_context/think/high-token has escalated.
 *   3. DEFAULT-UNCHANGED (ISC-3): no scenario signals, tokenCount below every threshold and no
 *      override -> return `baseTier` EXACTLY (even an unusual / unknown baseTier is passed through
 *      verbatim, since by definition there's no reason to touch it).
 *
 * Escalations clamp at opus; downgrades clamp at haiku. The result is never silently broken.
 *
 * @param {{
 *   baseTier?: string,
 *   scenario?: string[],
 *   tokenCount?: number,
 *   thresholds?: { tokenHigh?: number, tokenLow?: number },
 *   override?: (ctx: { baseTier: string, scenario: string[], tokenCount: number,
 *                      thresholds: { tokenHigh: number, tokenLow: number } }) => string|undefined,
 * }} [opts]
 * @returns {string} a tier name (a recognised tier when any rule fires; otherwise baseTier verbatim)
 */
export function routeTier({ baseTier = 'sonnet', scenario = [], tokenCount = 0, thresholds, override } = {}) {
  const th = {
    tokenHigh: DEFAULTS.thresholds.tokenHigh,
    tokenLow: DEFAULTS.thresholds.tokenLow,
    ...(thresholds && typeof thresholds === 'object' ? thresholds : {}),
  };

  const signals = Array.isArray(scenario) ? scenario.filter((s) => typeof s === 'string') : [];
  const n = Number(tokenCount);
  const tokens = Number.isFinite(n) && n > 0 ? n : 0;

  // --- 1) USER OVERRIDE HOOK WINS (when it yields a valid tier) -------------------------------
  if (typeof override === 'function') {
    let result;
    try {
      result = override({ baseTier, scenario: signals, tokenCount: tokens, thresholds: th });
    } catch {
      result = undefined; // a throwing hook must not break routing — fall through to rules.
    }
    if (isValidTier(result)) return result;
    // invalid / no result -> fall through to rule-based routing (don't crash, don't trust garbage).
  }

  const hasLongContext = signals.includes(SCENARIO_SIGNALS.LONG_CONTEXT) || tokens >= th.tokenHigh;
  const hasThink = signals.includes(SCENARIO_SIGNALS.THINK);
  const hasBackground = signals.includes(SCENARIO_SIGNALS.BACKGROUND);

  // --- 3) DEFAULT-UNCHANGED GUARANTEE (ISC-3) -------------------------------------------------
  // No scenario signals, no high/low-token rule applies (tokens between low and high, exclusive of
  // the high escalation), and no override matched -> return baseTier EXACTLY, untouched.
  if (signals.length === 0 && !hasLongContext) {
    return baseTier;
  }

  // From here a rule WILL fire; only now do we need baseTier to be a known tier to move it. An
  // unknown baseTier with a real signal can't be moved meaningfully — fall back to a safe known
  // tier ('sonnet') as the working base so we still return something valid.
  let tier = isValidTier(baseTier) ? baseTier : 'sonnet';

  // --- 2) RULE-BASED ESCALATION ---------------------------------------------------------------
  let escalated = false;

  // long_context / high token count: must be able to HOLD the context -> at least sonnet, then +1.
  if (hasLongContext) {
    tier = maxTier(tier, 'sonnet');
    tier = stepUp(tier, 1);
    escalated = true;
  }

  // think: extended reasoning -> one step up toward opus.
  if (hasThink) {
    tier = stepUp(tier, 1);
    escalated = true;
  }

  // background: only downgrades a SMALL, non-escalated request (cheap async work).
  if (hasBackground && !escalated && tokens < th.tokenLow) {
    tier = stepDown(tier, 1);
  }

  return tier;
}

/**
 * Build a reusable router with a bound user-overridable hook. The returned `route(ctx)` forwards to
 * routeTier with `override` pre-set to `overrideHook`, so callers configure the hook ONCE (e.g. from
 * project constraints) and then route many cards. An explicit `override` in a per-call ctx still
 * takes precedence over the bound hook (per card/agent control beats the project-wide hook).
 *
 * @param {{ overrideHook?: (ctx: any) => string|undefined }} [opts]
 * @returns {{ route: (ctx?: object) => string }}
 */
export function createRouter({ overrideHook } = {}) {
  return {
    /**
     * @param {{ baseTier?:string, scenario?:string[], tokenCount?:number,
     *           thresholds?:object, override?:Function }} [ctx]
     * @returns {string}
     */
    route(ctx = {}) {
      const override = typeof ctx.override === 'function' ? ctx.override : overrideHook;
      return routeTier({ ...ctx, override });
    },
  };
}
