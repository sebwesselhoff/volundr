#!/usr/bin/env node
/**
 * goal-evaluator.mjs — a REAL `/goal` completion-condition evaluator (FRW-BL-036 spike).
 *
 * Claude Code's `/goal` runs a "keep going until done" loop and, after each turn (and AFTER any
 * in-flight subagents finish), asks a completion evaluator: "is the goal met?" This module is that
 * evaluator. It is ADVISORY — it returns a verdict, it does NOT block-retry like a Stop hook (see
 * FRW-BL-028: Volundr's exit-2 loops are PreToolUse/TeammateIdle/TaskCompleted/WorktreeCreate, NOT
 * Stop-class, so the CLAUDE_CODE_STOP_HOOK_BLOCK_CAP cap can never fire from them; `/goal`
 * cooperates by being a pure verdict function the loop consults, not another Stop-hook retry).
 *
 * The completion CONDITION is deliberately STRICTER than loop-controller.detectCompletion (which
 * answers the coarse "is there schedulable work left?"). A real autonomous-run goal is met ONLY
 * when ALL of these hold simultaneously:
 *
 *   1. detectCompletion(state).complete === true   — backlog drained OR explicit completion.
 *   2. state.finalBuildGateGreen === true          — the final project build gate is green.
 *   3. NO partial cards and NO failed cards pending — no degraded/partial-results work outstanding.
 *   4. state.activeSubagents === 0                  — SUBAGENT-AWARE: never declare done while
 *                                                     teammates/subagents are still in-flight.
 *
 * Condition 4 is the load-bearing safety property: `/goal` WAITS for subagents before evaluating,
 * and even if asked early this evaluator refuses to declare victory mid-flight — a run with work
 * still executing in a teammate worktree is NOT done, no matter how clean the backlog looks.
 *
 * Pure Node, no external deps. Composes (does NOT modify) loop-controller.detectCompletion.
 * Self-test: scripts/goal-evaluator.test.mjs.
 */

import { detectCompletion } from './loop-controller.mjs';
import { notifyEvent as defaultNotifyEvent } from './notify-event.mjs';

/**
 * Resolve a "list of pending cards" value to either a non-negative integer count or the sentinel
 * UNSAFE (symbol) when the input is ambiguous/dangerous. The safety rule is:
 *
 *   - null / undefined / empty array  → 0   (safe: definitively nothing pending)
 *   - non-empty array                 → array.length  (safe: explicit list)
 *   - finite, non-negative integer    → that integer  (safe: explicit count)
 *   - negative finite number          → 0   (safe: treat as "none pending" — caller passed -1 as
 *                                           a sentinel meaning "not applicable")
 *   - ANYTHING ELSE (string, NaN, Infinity, object, boolean, fractional that rounds to ≥1, …)
 *                                     → UNSAFE  (block: caller sent an unparseable/non-finite value)
 *
 * Note: fractional positive numbers (e.g. 0.5) are treated as UNSAFE because their true intent
 * is unknown — we cannot floor a fractional card count and silently ignore the remainder.
 *
 * @param {unknown} value
 * @returns {number|symbol}  a non-negative integer, OR the UNSAFE sentinel
 */
const UNSAFE = Symbol('UNSAFE');
function pendingCount(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return UNSAFE;   // NaN, Infinity, -Infinity
    if (value < 0) return 0;                      // negative → treat as "none"
    if (!Number.isInteger(value)) return UNSAFE;  // fractional count is ambiguous
    return value;
  }
  // string, boolean, object, symbol, etc.
  return UNSAFE;
}

/**
 * Evaluate whether the autonomous-run GOAL is met. This is the `/goal` completion condition.
 *
 * goalMet is true ONLY when EVERY condition below holds. `blocking` enumerates, in evaluation
 * order, exactly which conditions are unmet (empty iff goalMet). `reason` is a single human-
 * readable summary line suitable for the `/goal` loop log.
 *
 * @param {{
 *   explicitComplete?: boolean,
 *   readyCardCount?: number,
 *   unblockedBacklogCount?: number,
 *   finalBuildGateGreen?: boolean,
 *   partialCards?: unknown[]|number|null,
 *   failedCards?: unknown[]|number|null,
 *   activeSubagents?: number,
 * }} state
 * @returns {{ goalMet: boolean, reason: string, blocking: string[] }}
 */
export function evaluateGoal(state = {}) {
  const {
    finalBuildGateGreen = false,
    partialCards = null,
    failedCards = null,
    activeSubagents = 0,
  } = state;

  const blocking = [];

  // 1. Loop-level completion (composed, not reimplemented). If detectCompletion says work remains,
  //    surface ITS reason so the operator sees the exact ready/unblocked counts.
  const completion = detectCompletion(state);
  if (!completion.complete) {
    blocking.push(`schedulable work remains: ${completion.reason}`);
  }

  // 2. Final build gate must be green.
  if (finalBuildGateGreen !== true) {
    blocking.push('final build gate is not green (finalBuildGateGreen !== true)');
  }

  // 3. No partial / failed cards outstanding.
  const partials = pendingCount(partialCards);
  if (partials === UNSAFE) {
    blocking.push(`unknown partialCards count: ${JSON.stringify(partialCards)}`);
  } else if (partials > 0) {
    blocking.push(`${partials} partial card(s) pending`);
  }
  const failed = pendingCount(failedCards);
  if (failed === UNSAFE) {
    blocking.push(`unknown failedCards count: ${JSON.stringify(failedCards)}`);
  } else if (failed > 0) {
    blocking.push(`${failed} failed card(s) pending`);
  }

  // 4. SUBAGENT-AWARE: never declare the goal met while subagents are in-flight.
  //    Any value that is not a finite non-negative integer is UNSAFE → block. We never silently
  //    treat an unrecognised activeSubagents value as "0 in-flight" — that is the false-"done" bug.
  //    Fractional positive values (e.g. 0.9) are floored for the message but still block, because
  //    a fractional subagent count means the caller's state is unreliable.
  let activeBlock = null;
  if (typeof activeSubagents !== 'number' || !Number.isFinite(activeSubagents)) {
    activeBlock = `unknown activeSubagents count: ${JSON.stringify(activeSubagents)}`;
  } else if (activeSubagents < 0) {
    // negative is safe → treat as 0, no block
  } else if (!Number.isInteger(activeSubagents)) {
    // fractional: floor for the message, but still block — caller's state is untrustworthy
    activeBlock = `${Math.floor(activeSubagents)} subagent(s) still in-flight (fractional count — refusing to declare goal met)`;
  } else if (activeSubagents > 0) {
    activeBlock = `${activeSubagents} subagent(s) still in-flight — refusing to declare goal met`;
  }
  if (activeBlock !== null) {
    blocking.push(activeBlock);
  }

  const goalMet = blocking.length === 0;
  const reason = goalMet
    ? 'goal met: backlog drained, final build gate green, no partial/failed cards, no active subagents'
    : `goal NOT met — ${blocking.length} blocking condition(s): ${blocking.join('; ')}`;

  return { goalMet, reason, blocking };
}

/**
 * Evaluate the goal AND, when it is MET, fire the `project_complete` notification (FRW-BL-063 ISC-3
 * `project_complete` emit site). This is the authoritative single completion-decision point: the
 * `/goal` loop's verdict function. We notify EXACTLY when goalMet flips true — `evaluateGoal` stays
 * a PURE verdict; this async wrapper adds the guarded, OFF-BY-DEFAULT, never-throws notification.
 *
 * @param {object} state same shape as evaluateGoal's state.
 * @param {object} [opts]
 * @param {object} [opts.notifyOpts] forwarded to notifyEvent (config/channels/env/fetch/…).
 * @param {(eventType: string, payload: object, opts: object) => Promise<any>} [opts.notify]
 *        dispatcher (default notify-event.notifyEvent). Injectable for tests.
 * @returns {Promise<{ goalMet: boolean, reason: string, blocking: string[], notified: boolean }>}
 */
export async function evaluateGoalAndNotify(state = {}, opts = {}) {
  const verdict = evaluateGoal(state);
  let notified = false;
  if (verdict.goalMet) {
    const notify = opts.notify ?? defaultNotifyEvent;
    try {
      const res = await notify('project_complete', { message: verdict.reason, ...(opts.payload || {}) }, opts.notifyOpts || {});
      notified = !!(res && res.fired);
    } catch {
      /* notifyEvent never throws, but double-guard the completion path regardless. */
    }
  }
  return { ...verdict, notified };
}

// Allow `node scripts/goal-evaluator.mjs` to print a quick self-demo of a met / not-met verdict.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('goal-evaluator.mjs')) {
  const met = evaluateGoal({ readyCardCount: 0, unblockedBacklogCount: 0, finalBuildGateGreen: true, activeSubagents: 0 });
  const notMet = evaluateGoal({ readyCardCount: 2, finalBuildGateGreen: false, activeSubagents: 1 });
  console.log('met   :', JSON.stringify(met));
  console.log('notMet:', JSON.stringify(notMet));
}
