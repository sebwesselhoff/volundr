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

/** Coerce an unknown "list of cards" shape to a count of pending entries. Accepts an array
 *  (its length), a number (used directly), or null/undefined (0). Defensive so callers can pass
 *  either `partialCards: ['frw-bl-052']` or `partialCards: 2`. Negative numbers clamp to 0. */
function pendingCount(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : 0;
  return 0;
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
  if (partials > 0) {
    blocking.push(`${partials} partial card(s) pending`);
  }
  const failed = pendingCount(failedCards);
  if (failed > 0) {
    blocking.push(`${failed} failed card(s) pending`);
  }

  // 4. SUBAGENT-AWARE: never declare the goal met while subagents are in-flight.
  const active = typeof activeSubagents === 'number' && Number.isFinite(activeSubagents)
    ? (activeSubagents > 0 ? activeSubagents : 0)
    : 0;
  if (active > 0) {
    blocking.push(`${active} subagent(s) still in-flight — refusing to declare goal met`);
  }

  const goalMet = blocking.length === 0;
  const reason = goalMet
    ? 'goal met: backlog drained, final build gate green, no partial/failed cards, no active subagents'
    : `goal NOT met — ${blocking.length} blocking condition(s): ${blocking.join('; ')}`;

  return { goalMet, reason, blocking };
}

// Allow `node scripts/goal-evaluator.mjs` to print a quick self-demo of a met / not-met verdict.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('goal-evaluator.mjs')) {
  const met = evaluateGoal({ readyCardCount: 0, unblockedBacklogCount: 0, finalBuildGateGreen: true, activeSubagents: 0 });
  const notMet = evaluateGoal({ readyCardCount: 2, finalBuildGateGreen: false, activeSubagents: 1 });
  console.log('met   :', JSON.stringify(met));
  console.log('notMet:', JSON.stringify(notMet));
}
