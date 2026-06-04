// Self-test for agent-liveness.mjs (FRW-BL-063 ISC-1). Run: node scripts/agent-liveness.test.mjs
import {
  classifyLiveness,
  annotateLiveness,
  resolveLastActivityMs,
  toEpochMs,
  processAlive,
  LIVENESS_DEFAULTS,
  TERMINAL_STATUSES,
} from './agent-liveness.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('agent-liveness self-test\n');

const NOW = 1_000_000_000_000; // fixed injected "now" — deterministic, no wall-clock
const { workingMs, stalledMs } = LIVENESS_DEFAULTS;

// --- working / idle / stalled boundaries (mtime-based) -----------------------
ok('recent activity (0ms ago) → working',
  classifyLiveness({ status: 'running', lastActivityMs: NOW }, NOW) === 'working');
ok('activity just inside workingMs → working',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - (workingMs - 1) }, NOW) === 'working');
ok('activity exactly AT workingMs boundary → idle (not < workingMs)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - workingMs }, NOW) === 'idle');
ok('activity between working and stalled → idle',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - (stalledMs - 1) }, NOW) === 'idle');
ok('activity exactly AT stalledMs boundary → stalled (>= stalledMs)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - stalledMs }, NOW) === 'stalled');
ok('activity well past stalledMs → stalled',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - stalledMs * 10 }, NOW) === 'stalled');

// --- completed / failed agent is NEVER stalled ------------------------------
for (const st of TERMINAL_STATUSES) {
  ok(`terminal status '${st}' (silent for an hour) → idle, never stalled`,
    classifyLiveness({ status: st, lastActivityMs: NOW - 3_600_000 }, NOW) === 'idle');
}
ok('completed agent with NO activity signal → idle (never stalled)',
  classifyLiveness({ status: 'completed' }, NOW) === 'idle');
ok('case-insensitive terminal status (COMPLETED) → idle',
  classifyLiveness({ status: 'COMPLETED', lastActivityMs: NOW - stalledMs * 5 }, NOW) === 'idle');

// --- process detection layered over mtime -----------------------------------
ok('process GONE + running + recent mtime → stalled (process detection wins)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW, processAlive: false }, NOW) === 'stalled');
ok('process GONE but agent completed → idle (terminal beats process detection)',
  classifyLiveness({ status: 'completed', lastActivityMs: NOW, processAlive: false }, NOW) === 'idle');
ok('process ALIVE + stale mtime → still stalled (mtime threshold still trips)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - stalledMs, processAlive: true }, NOW) === 'stalled');
ok('opts.processAlive=false overrides agent.processAlive=true → stalled',
  classifyLiveness({ status: 'running', lastActivityMs: NOW, processAlive: true }, NOW, { processAlive: false }) === 'stalled');

// --- no activity signal at all ----------------------------------------------
ok('running, no activity signal → idle (absence of mtime ≠ stalled)',
  classifyLiveness({ status: 'running' }, NOW) === 'idle');
ok('running, no mtime but process GONE → stalled',
  classifyLiveness({ status: 'running', processAlive: false }, NOW) === 'stalled');

// --- custom thresholds ------------------------------------------------------
ok('custom stalledMs=1000: activity 2s ago → stalled',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - 2000 }, NOW, { stalledMs: 1000, workingMs: 100 }) === 'stalled');
ok('custom workingMs=10000: activity 5s ago → working',
  classifyLiveness({ status: 'running', lastActivityMs: NOW - 5000 }, NOW, { workingMs: 10000 }) === 'working');

// --- determinism + clock-skew guard -----------------------------------------
const agent = { status: 'running', lastActivityMs: NOW - 1000 };
ok('deterministic: same inputs → same output (no wall-clock)',
  classifyLiveness(agent, NOW) === classifyLiveness(agent, NOW));
ok('future timestamp (clock skew) → working (no negative-age stall)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW + 60_000 }, NOW) === 'working');

// --- now must be provided ---------------------------------------------------
let threw = false;
try { classifyLiveness({ status: 'running', lastActivityMs: 0 }); } catch { threw = true; }
ok('missing now → throws (no implicit wall-clock)', threw === true);
let threw2 = false;
try { classifyLiveness({ status: 'running' }, NaN); } catch { threw2 = true; }
ok('NaN now → throws', threw2 === true);

// --- resolveLastActivityMs: freshest signal wins, ISO parsing ---------------
ok('resolveLastActivityMs: picks max of provided signals',
  resolveLastActivityMs({ lastActivityMs: 100, heartbeatMs: 500, startedAt: 50 }) === 500);
ok('resolveLastActivityMs: parses ISO updatedAt to epoch ms',
  resolveLastActivityMs({ updatedAt: '2026-06-04T12:00:00Z' }) === Date.parse('2026-06-04T12:00:00Z'));
// TZ FIX: a naive SQLite "YYYY-MM-DD HH:MM:SS" (no zone) MUST be parsed as UTC, NOT local. The
// previous test enshrined the bug by comparing to Date.parse('...T12:00:00') (local). Correct:
ok('resolveLastActivityMs: naive "YYYY-MM-DD HH:MM:SS" parsed as UTC (Z appended), not local',
  resolveLastActivityMs({ startedAt: '2026-06-04 12:00:00' }) === Date.parse('2026-06-04T12:00:00Z'));
ok('resolveLastActivityMs: nothing usable → null',
  resolveLastActivityMs({}) === null);

// --- FIX 1: timezone — naive DB timestamps are UTC; .mjs twin must agree with .ts twin ----------
// Reproduce the EXACT logic of dashboard/packages/api/src/lib/liveness.ts toEpochMs and assert the
// .mjs toEpochMs produces the SAME epoch (UTC) for a naive timestamp. This catches a future
// regression where one twin drifts from the other.
function tsToEpochMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s.replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
const NAIVE = '2026-06-04 12:00:00';
ok('toEpochMs(naive) treats it as UTC (== explicit Z)',
  toEpochMs(NAIVE) === Date.parse('2026-06-04T12:00:00Z'));
ok('TZ-twin-agreement: .mjs toEpochMs === .ts twin logic for naive timestamp',
  toEpochMs(NAIVE) === tsToEpochMs(NAIVE));
ok('TZ-twin-agreement: .mjs toEpochMs === .ts twin logic for zoned ISO',
  toEpochMs('2026-06-04T12:00:00Z') === tsToEpochMs('2026-06-04T12:00:00Z'));
ok('toEpochMs: numeric passthrough', toEpochMs(NOW) === NOW);
ok('toEpochMs: garbage → null', toEpochMs('not-a-date') === null && toEpochMs(null) === null);

// A just-now NAIVE (UTC) timestamp must classify 'working', NOT 'stalled'. Build the naive string
// from `now` in UTC so it is genuinely recent. (Under the old local-misparse bug, a host with a
// positive UTC offset would see this as hours in the past → wrongly 'stalled'.)
function naiveUtc(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
{
  const nowReal = Date.parse('2026-06-04T12:00:00Z'); // fixed instant; act as "now"
  const justNowNaive = naiveUtc(nowReal); // "2026-06-04 12:00:00"
  ok('just-now naive timestamp → working (not stalled) — TZ-correct',
    classifyLiveness({ status: 'running', updatedAt: justNowNaive }, nowReal) === 'working');
  // And explicitly: had it been misparsed as local on a UTC+N host it would be N hours stale; we
  // assert the resolved epoch equals the true UTC instant so age is ~0 regardless of host TZ.
  ok('just-now naive resolves to the true UTC instant (age ~0 on any host)',
    resolveLastActivityMs({ updatedAt: justNowNaive }) === nowReal);
}

// --- FIX 3: processAlive integration into classifyLiveness (deterministic via injected detector) -
// Dead pid forces 'stalled' even with a fresh mtime.
ok('processAlive: dead pid (detector→false) → stalled despite recent mtime',
  classifyLiveness({ status: 'running', pid: 4242, lastActivityMs: NOW }, NOW,
    { processDetector: () => false }) === 'stalled');
// Live pid → detector says alive → falls through to mtime path (recent → working).
ok('processAlive: live pid (detector→true) + recent mtime → working (mtime path)',
  classifyLiveness({ status: 'running', pid: 4242, lastActivityMs: NOW }, NOW,
    { processDetector: () => true }) === 'working');
// Live pid but stale mtime → still stalled via mtime threshold.
ok('processAlive: live pid + stale mtime → stalled (mtime threshold trips)',
  classifyLiveness({ status: 'running', pid: 4242, lastActivityMs: NOW - stalledMs }, NOW,
    { processDetector: () => true }) === 'stalled');
// Detector unavailable (undefined) → fall back to mtime (recent → working), NOT treated as dead.
ok('processAlive: detector→undefined → falls back to mtime (recent → working, not stalled)',
  classifyLiveness({ status: 'running', pid: 4242, lastActivityMs: NOW }, NOW,
    { processDetector: () => undefined }) === 'working');
// No pid at all → detector never consulted → pure mtime path.
ok('processAlive: no pid → mtime path (recent → working)',
  classifyLiveness({ status: 'running', lastActivityMs: NOW }, NOW,
    { processDetector: () => false }) === 'working');
// agent.pid present but detector throws → swallowed → mtime fallback (never breaks classification).
ok('processAlive: detector throw is swallowed → mtime fallback (working)',
  classifyLiveness({ status: 'running', pid: 4242, lastActivityMs: NOW }, NOW,
    { processDetector: () => { throw new Error('boom'); } }) === 'working');
// Dead pid on a terminal agent → still idle (terminal beats process detection).
ok('processAlive: dead pid but completed → idle (terminal wins)',
  classifyLiveness({ status: 'completed', pid: 4242, lastActivityMs: NOW }, NOW,
    { processDetector: () => false }) === 'idle');

// --- processAlive() real helper: never throws, returns boolean|undefined ------------------------
// Contract: for a LIVE pid the result is true OR undefined (when the OS probe is unavailable/blocked
// — e.g. a sandbox that disallows tasklist) — but NEVER false. We must not wrongly mark a live
// process as dead. (Asserting strictly `=== true` is environment-fragile; the load-bearing property
// is "never falsely false, never throws".)
{
  const r = processAlive(process.pid); // our own process is definitely alive
  ok('processAlive(current pid) → true|undefined, never false, never throws', r === true || r === undefined);
}
ok('processAlive(invalid pid 0/-1/non-numeric) → undefined (no usable pid)',
  processAlive(0) === undefined && processAlive(-1) === undefined && processAlive('x') === undefined);
{
  // A pid that is essentially guaranteed not to exist; result is false (dead) or undefined
  // (probe unavailable) — never throws, never true. Accept either non-true outcome.
  const r = processAlive(2_000_000_000);
  ok('processAlive(nonexistent huge pid) → false|undefined, never throws/true', r !== true);
}
ok('resolveLastActivityMs: updatedAt fresher than startedAt drives working',
  classifyLiveness({ status: 'running', startedAt: '2000-01-01T00:00:00Z',
    updatedAt: new Date(NOW).toISOString() }, NOW) === 'working');

// --- annotateLiveness batch helper ------------------------------------------
const batch = annotateLiveness([
  { id: 'a', status: 'running', lastActivityMs: NOW },
  { id: 'b', status: 'running', lastActivityMs: NOW - stalledMs },
  { id: 'c', status: 'completed', lastActivityMs: NOW - stalledMs },
], NOW);
ok('annotateLiveness: working/stalled/idle annotated per agent',
  batch[0].liveness === 'working' && batch[1].liveness === 'stalled' && batch[2].liveness === 'idle');
ok('annotateLiveness: preserves original fields (id)',
  batch[0].id === 'a' && batch[1].id === 'b');
ok('annotateLiveness: empty/undefined input → []',
  annotateLiveness([], NOW).length === 0 && annotateLiveness(undefined, NOW).length === 0);

// --- defaults shape ---------------------------------------------------------
ok('LIVENESS_DEFAULTS: workingMs 30s, stalledMs 5min',
  LIVENESS_DEFAULTS.workingMs === 30_000 && LIVENESS_DEFAULTS.stalledMs === 5 * 60_000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
