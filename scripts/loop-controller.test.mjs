// Self-test for loop-controller.mjs (FRW-BL-050). Run: node scripts/loop-controller.test.mjs
import {
  normalizeFailureSignature,
  hashSignature,
  createFailureTracker,
  createIterationGuard,
  detectCompletion,
  DEFAULTS,
} from './loop-controller.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('loop-controller self-test\n');

// --- normalization collapses volatile noise to one signature -----------------
// Two failures that differ ONLY in timestamp, absolute path, :line:col, and duration.
const errA = 'ERR 2026-06-03T12:34:56.789Z TypeError: x is undefined at C:\\repo\\src\\foo.mjs:120:8 (took 123ms)';
const errB = 'ERR 2026-01-01T00:00:00Z TypeError: x is undefined at /home/u/proj/foo.mjs:9:42 (took 4.5s)';
const sigA = normalizeFailureSignature(errA);
const sigB = normalizeFailureSignature(errB);
ok('volatile-only diffs → SAME signature', sigA === sigB);
ok('volatile-only diffs → SAME hash', hashSignature(sigA) === hashSignature(sigB));

// A genuinely different structural error → different signature + hash.
const errC = 'ERR 2026-06-03T12:34:56.789Z ReferenceError: y is not defined at C:\\repo\\src\\bar.mjs:7:3 (took 12ms)';
const sigC = normalizeFailureSignature(errC);
ok('different error KIND → different signature', sigC !== sigA);
ok('different error KIND → different hash', hashSignature(sigC) !== hashSignature(sigA));

// Strips UUID, hex/sha, epoch ms, port.
const u1 = normalizeFailureSignature('failed job 550e8400-e29b-41d4-a716-446655440000 sha 9f86d081a sat port 3141 epoch 1717416000000');
const u2 = normalizeFailureSignature('failed job 11111111-2222-3333-4444-555555555555 sha deadbeef1 sat port 8080 epoch 1700000000000');
ok('uuid/hash/port/epoch all normalized → SAME signature', u1 === u2);

ok('null/undefined → empty string (no throw)', normalizeFailureSignature(null) === '' && normalizeFailureSignature(undefined) === '');
ok('hashSignature is stable + 12 hex chars', /^[0-9a-f]{12}$/.test(hashSignature(sigA)) && hashSignature(sigA) === hashSignature(sigA));

// --- Windows path normalization (regression tests for FRW-BL-050 reopen) -----
// Parenthesized stack frames: same error, different C:\ paths and :line:col → SAME signature+hash.
const winStack1 = 'TypeError: x is undefined\n    at f (C:\\Users\\Seb\\proj\\src\\a.mjs:12:5)';
const winStack2 = 'TypeError: x is undefined\n    at f (C:\\Users\\Bob\\work\\lib\\a.mjs:88:2)';
const wSig1 = normalizeFailureSignature(winStack1);
const wSig2 = normalizeFailureSignature(winStack2);
ok('Windows parenthesized stack frame: same error + diff C:\\ path/loc → SAME signature', wSig1 === wSig2);
ok('Windows parenthesized stack frame: SAME hash', hashSignature(wSig1) === hashSignature(wSig2));

// Bare Windows drive-letter paths (not in parens).
const winBare1 = 'build failed: C:\\proj\\src\\index.mjs:5:3 unexpected token';
const winBare2 = 'build failed: C:\\work\\lib\\other.mjs:99:1 unexpected token';
ok('bare Windows path: same error + diff drive-letter path → SAME signature',
  normalizeFailureSignature(winBare1) === normalizeFailureSignature(winBare2));

// UNC paths \\host\share\... collapse to <PATH>.
const unc1 = 'error reading \\\\server\\share\\data\\file.txt:3:1';
const unc2 = 'error reading \\\\server\\share\\other\\file.txt:7:9';
ok('UNC path: collapses to <PATH>', normalizeFailureSignature(unc1).includes('<PATH>'));
ok('UNC path: two different UNC paths → SAME signature',
  normalizeFailureSignature(unc1) === normalizeFailureSignature(unc2));

// Different error KIND on the SAME Windows path → DIFFERENT signature (no over-collapse).
const winKind1 = normalizeFailureSignature('TypeError: x is undefined at f (C:\\Users\\Seb\\proj\\src\\a.mjs:12:5)');
const winKind2 = normalizeFailureSignature('ReferenceError: y is not defined at f (C:\\Users\\Seb\\proj\\src\\a.mjs:12:5)');
ok('different error kind, same Windows path → DIFFERENT signature (no over-collapse)', winKind1 !== winKind2);

// Over-match guard: structural words AFTER a Windows path survive normalization.
const withTrailing = normalizeFailureSignature('build failed at C:\\proj\\src after retry exhausted');
ok('structural words after Windows path survive (no space in path char-class)', withTrailing.includes('after retry exhausted'));

// POSIX parity: still works correctly (regression guard).
const posix1 = normalizeFailureSignature('TypeError: x is undefined at /home/alice/proj/src/a.mjs:12:5');
const posix2 = normalizeFailureSignature('TypeError: x is undefined at /home/bob/work/lib/a.mjs:88:2');
ok('POSIX parity: same error + diff POSIX path → SAME signature', posix1 === posix2);

// --- failure tracker: escalates at exactly K, independent counts -------------
const tracker = createFailureTracker({ K: 3 });
const r1 = tracker.record(errA);
const r2 = tracker.record(errB); // same signature as errA (volatile-only diff)
ok('tracker: K-1 occurrences → escalate false', r1.escalate === false && r2.escalate === false && r2.count === 2);
const r3 = tracker.record('ERR 2099-09-09T09:09:09Z TypeError: x is undefined at ./z.mjs:1:1 (took 9s)');
ok('tracker: Kth identical occurrence → escalate true', r3.escalate === true && r3.count === 3);

// Independent counts per signature: a DIFFERENT error has its own count, not escalated.
const rC = tracker.record(errC);
ok('tracker: different signature counted independently (count 1, no escalate)', rC.count === 1 && rC.escalate === false);
ok('tracker: counts() shows two distinct signatures', Object.keys(tracker.counts()).length === 2);
ok('tracker: counts() values are 3 and 1', JSON.stringify(Object.values(tracker.counts()).sort()) === JSON.stringify([1, 3]));

tracker.reset();
ok('tracker: reset() clears all counts', Object.keys(tracker.counts()).length === 0);

// Escalation stays true past K (caller that keeps recording still sees the blocker).
const t2 = createFailureTracker({ K: 2 });
t2.record(errA);
ok('tracker: K=2 escalates on 2nd', t2.record(errA).escalate === true);
ok('tracker: stays escalated at K+1', t2.record(errA).escalate === true);

// --- iteration guard: trips at maxIterations and at cost ceiling -------------
const guard = createIterationGuard({ maxIterations: 5, costCeilingUsd: 10 });
ok('guard: below both limits → withinLimits true', guard.check({ iterations: 4, costSpentUsd: 9.99 }).withinLimits === true);
const gi = guard.check({ iterations: 5, costSpentUsd: 0 });
ok('guard: iterations >= max → trips with reason', gi.withinLimits === false && /max iterations/.test(gi.reason));
const gc = guard.check({ iterations: 0, costSpentUsd: 10 });
ok('guard: cost >= ceiling → trips with reason', gc.withinLimits === false && /cost ceiling/.test(gc.reason));

// No cost ceiling → only iterations bound it (any spend is fine).
const guardNoCost = createIterationGuard({ maxIterations: 3 });
ok('guard: null ceiling → cost never trips', guardNoCost.check({ iterations: 2, costSpentUsd: 99999 }).withinLimits === true);
ok('guard: null ceiling → iterations still trip', guardNoCost.check({ iterations: 3, costSpentUsd: 0 }).withinLimits === false);

// Defaults applied when constructed empty.
const guardDef = createIterationGuard();
ok('guard: default maxIterations from DEFAULTS', guardDef.check({ iterations: DEFAULTS.maxIterations }).withinLimits === false);

// --- completion detector: explicit vs no-work vs work-remains ----------------
ok('complete: explicitComplete=true → complete', detectCompletion({ explicitComplete: true, readyCardCount: 99, unblockedBacklogCount: 99 }).complete === true);
ok('complete: 0 ready + 0 unblocked → complete', detectCompletion({ readyCardCount: 0, unblockedBacklogCount: 0 }).complete === true);
// Distinct from per-card ISC pass: cards still ready/unblocked → loop NOT complete.
ok('complete: ready cards remain → NOT complete', detectCompletion({ readyCardCount: 2, unblockedBacklogCount: 0 }).complete === false);
ok('complete: unblocked backlog remains → NOT complete', detectCompletion({ readyCardCount: 0, unblockedBacklogCount: 5 }).complete === false);
ok('complete: not-complete reason notes ISC pass is distinct', /ISC/.test(detectCompletion({ readyCardCount: 1, unblockedBacklogCount: 0 }).reason));
ok('complete: empty state → complete (no work declared)', detectCompletion().complete === true);

// --- DEFAULTS shape ----------------------------------------------------------
ok('DEFAULTS exports K/maxIterations/costCeilingUsd', DEFAULTS.K === 3 && DEFAULTS.maxIterations === 5 && DEFAULTS.costCeilingUsd === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
