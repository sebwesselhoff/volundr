// Self-test for goal-evaluator.mjs (FRW-BL-036). Run: node scripts/goal-evaluator.test.mjs
import { evaluateGoal } from './goal-evaluator.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('goal-evaluator self-test\n');

// A baseline "everything done" state — used as the green template that each negative test breaks
// exactly one condition of, isolating that condition's effect on goalMet/blocking.
const DONE = Object.freeze({
  explicitComplete: false,
  readyCardCount: 0,
  unblockedBacklogCount: 0,
  finalBuildGateGreen: true,
  partialCards: [],
  failedCards: [],
  activeSubagents: 0,
});

// ── goalMet === true ONLY when every condition holds ──────────────────────────────────────────
const done = evaluateGoal(DONE);
ok('goalMet TRUE when complete + gate green + no partials/failures + 0 subagents', done.goalMet === true);
ok('blocking empty when goal met', Array.isArray(done.blocking) && done.blocking.length === 0);
ok('reason states goal met', /goal met/i.test(done.reason));

// explicit completion variant (backlog could be anything but explicitComplete short-circuits it)
const explicitDone = evaluateGoal({ ...DONE, explicitComplete: true, readyCardCount: 9, unblockedBacklogCount: 9 });
ok('goalMet TRUE via explicitComplete even with ready/unblocked counts', explicitDone.goalMet === true);

// ── goalMet === false when ready/unblocked work remains ─────────────────────────────────────────
const ready = evaluateGoal({ ...DONE, readyCardCount: 3 });
ok('goalMet FALSE when ready cards remain', ready.goalMet === false);
ok('blocking names schedulable work', ready.blocking.some(b => /schedulable work remains/.test(b)));

const unblocked = evaluateGoal({ ...DONE, unblockedBacklogCount: 1 });
ok('goalMet FALSE when unblocked backlog remains', unblocked.goalMet === false);

// ── goalMet === false when final build gate not green ───────────────────────────────────────────
const noGate = evaluateGoal({ ...DONE, finalBuildGateGreen: false });
ok('goalMet FALSE when build gate not green', noGate.goalMet === false);
ok('blocking names build gate', noGate.blocking.some(b => /build gate/i.test(b)));

const gateUndefined = evaluateGoal({ readyCardCount: 0, unblockedBacklogCount: 0, activeSubagents: 0 });
ok('goalMet FALSE when finalBuildGateGreen omitted (defaults false)', gateUndefined.goalMet === false);

// ── goalMet === false when partials / failures pending ──────────────────────────────────────────
const partialArr = evaluateGoal({ ...DONE, partialCards: ['frw-bl-052'] });
ok('goalMet FALSE when partial cards (array) pending', partialArr.goalMet === false);
ok('blocking names partial card count', partialArr.blocking.some(b => /1 partial card/.test(b)));

const partialNum = evaluateGoal({ ...DONE, partialCards: 2 });
ok('goalMet FALSE when partialCards given as a number', partialNum.goalMet === false && partialNum.blocking.some(b => /2 partial card/.test(b)));

const failedArr = evaluateGoal({ ...DONE, failedCards: ['frw-bl-099', 'frw-bl-100'] });
ok('goalMet FALSE when failed cards pending', failedArr.goalMet === false);
ok('blocking names failed card count', failedArr.blocking.some(b => /2 failed card/.test(b)));

// ── goalMet === false when activeSubagents > 0 (SUBAGENT-AWARE) ─────────────────────────────────
const inflight = evaluateGoal({ ...DONE, activeSubagents: 1 });
ok('goalMet FALSE when a subagent is in-flight', inflight.goalMet === false);
ok('blocking names in-flight subagents', inflight.blocking.some(b => /subagent\(s\) still in-flight/.test(b)));

// even with backlog drained + gate green + no partials, ONE active subagent blocks the goal
const inflightOnly = evaluateGoal({ ...DONE, activeSubagents: 3 });
ok('subagent-aware: 3 in-flight blocks an otherwise-complete state', inflightOnly.goalMet === false && inflightOnly.blocking.length === 1);

// ── blocking correctly enumerates MULTIPLE unmet conditions at once ─────────────────────────────
const allBad = evaluateGoal({ readyCardCount: 2, finalBuildGateGreen: false, partialCards: ['x'], failedCards: ['y'], activeSubagents: 1 });
ok('blocking enumerates ALL unmet conditions (5)', allBad.goalMet === false && allBad.blocking.length === 5);
ok('reason summarizes blocking count', /5 blocking condition/.test(allBad.reason));

// ── defensive: negative / non-finite counts clamp to 0 (do not falsely block) ───────────────────
const negative = evaluateGoal({ ...DONE, partialCards: -1, failedCards: NaN, activeSubagents: -5 });
ok('negative / NaN counts clamp to 0 → goal still met', negative.goalMet === true);

// ── no-arg call does not throw and is NOT met (defaults are all "not done") ──────────────────────
const empty = evaluateGoal();
ok('evaluateGoal() with no args → not met, does not throw', empty.goalMet === false && empty.blocking.length >= 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
