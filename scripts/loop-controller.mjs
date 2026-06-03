#!/usr/bin/env node
/**
 * loop-controller.mjs — autonomous-loop circuit breaker + completion detector (FRW-BL-050)
 *
 * Autonomous runs (Ralph-style "keep going until done" loops) have two failure modes this
 * module guards against:
 *
 *   1. BURNING RETRY BUDGET ON THE SAME ERROR. A loop that retries a card after an identical
 *      failure will keep failing identically forever (oh-my-claudecode "same-error-3x"). We
 *      normalize each failure to a stable SIGNATURE (volatile noise — timestamps, paths,
 *      line:col, hashes, durations, ports — stripped) and escalate the Kth identical signature
 *      as a STRUCTURAL BLOCKER: stop retrying, surface it for a human/architect.
 *
 *   2. RUNAWAY LOOPS. A per-card iteration cap AND an optional USD cost ceiling bound the loop
 *      regardless of failure shape (Shannon-style budget enforcement).
 *
 * And it provides what per-card ISC pass does NOT: an EXPLICIT, project/loop-level COMPLETION
 * signal. See `detectCompletion` — completion is the loop terminator, distinct from "this one
 * card's ISC passed" (a finer, per-card success used by the quality gate).
 *
 * Pure Node, no external deps (node:crypto only). Exported functions are pure / closure-based
 * so they unit-test without I/O. Self-test: scripts/loop-controller.test.mjs.
 */

import { createHash } from 'node:crypto';

/** Project-wide defaults. K = identical-failures-before-escalation; maxIterations / cost cap
 *  bound a single card's retry loop. costCeilingUsd null = no cost ceiling (iterations only). */
export const DEFAULTS = Object.freeze({
  K: 3,
  maxIterations: 5,
  costCeilingUsd: null,
});

/**
 * Strip run-specific / volatile noise from a failure message so that "the same error" — emitted
 * on different runs, at different times, from different absolute paths — collapses to ONE stable
 * signature. We deliberately keep the structural message text (the part that distinguishes one
 * KIND of failure from another) and only erase the parts that change run-to-run.
 *
 * Order matters: replace the most specific / composite tokens (UUIDs, durations, line:col) before
 * the generic ones (bare numbers, paths) so a later rule does not chew up part of an earlier one.
 *
 * @param {string} text raw failure text / stderr / message
 * @returns {string} normalized, trimmed, single-spaced signature string
 */
export function normalizeFailureSignature(text) {
  if (text == null) return '';
  let s = String(text);

  // ISO-8601 timestamps (with optional fractional seconds and Z/offset).
  s = s.replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/g, '<TS>');

  // UUID v1–v5.
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>');

  // Long hex / sha digests (git sha, sha256, etc.) — 7+ hex chars.
  s = s.replace(/\b[0-9a-f]{7,}\b/gi, '<HASH>');

  // Durations: "123ms", "4.5s", "2m", "1.2h" (and "123 ms" with a space).
  s = s.replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|m|h)\b/gi, '<DUR>');

  // Windows + POSIX absolute/relative file paths, collapsed to <PATH>. :line:col handled next.
  // Path segment chars: word chars, dot, hyphen. NO bare space (would eat structural message text).
  // Order: UNC first (\\host\share\...), then drive-letter (C:\...), then POSIX (/a/b), then relative.
  // Each rule requires at least 2 separator+segment pairs so a single bare word is not a path.
  // UNC: \\host\share[\seg...] — two leading backslashes then segments.
  s = s.replace(/\\{2}[\w.\-]+(?:\\[\w.\-]+){1,}(?:\\)?/g, '<PATH>');
  // Windows drive-letter: C:\seg\seg[\seg...] (backslash or forward slash separators).
  s = s.replace(/[A-Za-z]:(?:[\\/][\w.\-]+){2,}(?:[\\/])?/g, '<PATH>');
  // POSIX absolute: /seg/seg[/seg...].
  s = s.replace(/\/[\w.\-]+(?:\/[\w.\-]+){1,}(?:\/)?/g, '<PATH>');
  // Relative: ./ or ../ prefix followed by at least one more segment.
  s = s.replace(/\.{1,2}[\\/][\w.\-]+(?:[\\/][\w.\-]+)*/g, '<PATH>');

  // :line:col or :line trailing a path/identifier (e.g. "<PATH>:120:8" or "file:42").
  s = s.replace(/:\d+(?::\d+)?\b/g, ':<LOC>');

  // Epoch milliseconds / large run ids (10+ digit integers).
  s = s.replace(/\b\d{10,}\b/g, '<EPOCH>');

  // TCP/UDP ports: ":3141", "port 8080".
  s = s.replace(/\bport\s+\d{2,5}\b/gi, 'port <PORT>');
  s = s.replace(/:\d{2,5}\b/g, ':<PORT>');

  // Remaining bare numbers (counts, indices) — collapse so "retry 1/5" == "retry 2/5".
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, '<N>');

  // Whitespace normalize.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Short, stable, content-addressed hash of a normalized signature. First 12 hex chars of a
 * sha256 — collision-safe enough to key a per-run failure table, short enough to log/display.
 * @param {string} normalized output of normalizeFailureSignature
 * @returns {string} 12-char lowercase hex
 */
export function hashSignature(normalized) {
  return createHash('sha256').update(String(normalized == null ? '' : normalized)).digest('hex').slice(0, 12);
}

/**
 * Identical-failure circuit breaker. Records each failure by its normalized signature/hash and
 * escalates the Kth occurrence of any one signature as a structural blocker — the loop should
 * STOP retrying that failure and surface it (human/architect) instead of burning more budget.
 *
 * @param {{K?: number}} [opts] K = identical failures before escalation (default DEFAULTS.K)
 * @returns {{ record: (text: string) => {signature: string, hash: string, count: number, escalate: boolean},
 *             counts: () => Record<string, number>, reset: () => void }}
 */
export function createFailureTracker({ K = DEFAULTS.K } = {}) {
  // hash -> { signature, count }
  const table = new Map();
  return {
    /** Record one failure; returns its signature, hash, running count, and whether to escalate.
     *  `escalate` is true EXACTLY when this signature's count reaches K (not before, and it
     *  stays true for K+1, K+2, … so a caller that keeps recording still sees the blocker). */
    record(text) {
      const signature = normalizeFailureSignature(text);
      const hash = hashSignature(signature);
      const entry = table.get(hash) || { signature, count: 0 };
      entry.count += 1;
      table.set(hash, entry);
      return { signature, hash, count: entry.count, escalate: entry.count >= K };
    },
    /** Snapshot of hash -> count (independent per signature). */
    counts() {
      const out = {};
      for (const [hash, entry] of table) out[hash] = entry.count;
      return out;
    },
    /** Forget all recorded failures (e.g. on a genuine code change between attempts). */
    reset() {
      table.clear();
    },
  };
}

/**
 * Runaway-loop guard. Trips when the per-card iteration cap is hit OR (if a cost ceiling is set)
 * when cumulative USD spend reaches it. Independent of failure shape — bounds even a loop that
 * keeps producing NEW errors.
 *
 * @param {{maxIterations?: number, costCeilingUsd?: number|null}} [opts]
 * @returns {{ check: (state: {iterations: number, costSpentUsd?: number}) =>
 *             {withinLimits: boolean, reason: string|null} }}
 */
export function createIterationGuard({ maxIterations = DEFAULTS.maxIterations, costCeilingUsd = DEFAULTS.costCeilingUsd } = {}) {
  return {
    /** @param {{iterations: number, costSpentUsd?: number}} state */
    check({ iterations = 0, costSpentUsd = 0 } = {}) {
      if (iterations >= maxIterations) {
        return { withinLimits: false, reason: `max iterations reached (${iterations} >= ${maxIterations})` };
      }
      if (costCeilingUsd != null && costSpentUsd >= costCeilingUsd) {
        return { withinLimits: false, reason: `cost ceiling reached ($${costSpentUsd} >= $${costCeilingUsd})` };
      }
      return { withinLimits: true, reason: null };
    },
  };
}

/**
 * EXPLICIT loop/project-level completion detector.
 *
 * IMPORTANT — this is a DIFFERENT, COARSER signal than per-card ISC pass. Per-card ISC pass means
 * "this one card's binary acceptance criteria are met" (the quality gate's finer, per-unit
 * success). COMPLETION means "the autonomous LOOP should terminate" — either an operator/goal
 * explicitly declared done, or there is genuinely no work left to schedule. A run can have many
 * cards pass ISC while completion is still false (more ready/unblocked work remains); conversely
 * the loop completes only once, when the whole backlog is drained or completion is declared.
 *
 * @param {{explicitComplete?: boolean, readyCardCount?: number, unblockedBacklogCount?: number}} state
 * @returns {{complete: boolean, reason: string}}
 */
export function detectCompletion(state = {}) {
  const {
    explicitComplete = false,
    readyCardCount = 0,
    unblockedBacklogCount = 0,
  } = state;

  if (explicitComplete === true) {
    return { complete: true, reason: 'explicit completion signal (operator/goal declared done)' };
  }
  if (readyCardCount === 0 && unblockedBacklogCount === 0) {
    return { complete: true, reason: 'no work remaining (0 ready cards, 0 unblocked backlog)' };
  }
  return {
    complete: false,
    reason: `work remains (${readyCardCount} ready, ${unblockedBacklogCount} unblocked) — per-card ISC pass is NOT loop completion`,
  };
}
