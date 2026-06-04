#!/usr/bin/env node
/**
 * agent-liveness.mjs — stalled-agent detection / liveness classification (FRW-BL-063 ISC-1)
 *
 * A long autonomous run can have a teammate go silent: its OS process is gone, or it is alive but
 * producing no new log/heartbeat output for minutes. The orchestrator needs to tell the difference
 * between a teammate that is WORKING, one that is merely IDLE (briefly between turns), and one that
 * has STALLED (no activity past a threshold while still notionally 'running') so it can notify the
 * operator (see notify.mjs) and/or intervene.
 *
 * `classifyLiveness` is the PURE core. It takes:
 *   - an agent record (status + the last time we saw activity from it),
 *   - the current time `now` (injected — NO wall-clock read inside the core, so it is deterministic
 *     and unit-testable),
 *   - thresholds + an optional process-detection result.
 * …and returns one of 'working' | 'idle' | 'stalled'.
 *
 * Classification logic (process detection layered over activity-mtime):
 *   - A terminal agent (completed / failed / timeout / cancelled) is NEVER 'stalled' — it is done,
 *     not stuck. We report 'idle' for it (no liveness concern).
 *   - If process detection is supplied and says the process is GONE while status is still 'running',
 *     that is the strongest stall signal → 'stalled' regardless of mtime.
 *   - Otherwise we look at how long since the last activity (`now - lastActivityMs`):
 *       • within workingMs            → 'working'  (recent heartbeat/log/updatedAt)
 *       • >= stalledMs AND running    → 'stalled'  (silent past the stall threshold)
 *       • in between                  → 'idle'     (quiet but not yet alarming)
 *
 * Pure Node, no external deps. Self-test: scripts/agent-liveness.test.mjs.
 */

import { createRequire } from 'node:module';
// `require` shim so processAlive can lazily load the built-in node:child_process from this ESM file
// (only on the Windows path, only when actually probing a pid — the pure core stays import-free).
const require = createRequire(import.meta.url);

/** Liveness thresholds (milliseconds). Activity newer than workingMs ⇒ working; older than
 *  stalledMs (and still running) ⇒ stalled; in between ⇒ idle. Defaults: 30s working window,
 *  5min stall threshold. Override per-call via opts. */
export const LIVENESS_DEFAULTS = Object.freeze({
  workingMs: 30_000,      // 30s — recent activity ⇒ actively working
  stalledMs: 5 * 60_000,  // 5min — no activity past this (while running) ⇒ stalled
});

/** Statuses that mean the agent has finished and can never be 'stalled'. */
export const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'timeout', 'cancelled']);

/**
 * Parse a SQLite/ISO timestamp string (or number) to epoch ms; null if unparseable.
 *
 * CRITICAL — naive timestamps are UTC. SQLite `datetime('now')` (and our updatedAt/startedAt/
 * lastEventAt/heartbeatAt columns) emit a NAIVE "YYYY-MM-DD HH:MM:SS" with NO zone. `Date.parse`
 * of `"YYYY-MM-DDTHH:MM:SS"` (space→T, no zone) is interpreted as LOCAL time, which makes liveness
 * diverge from the DB's true UTC instant by the host's UTC offset (hours of skew → a just-started
 * agent can look stalled, or vice-versa). We therefore APPEND `Z` for the naive shape so it parses
 * as UTC. This is the EXACT twin of dashboard/packages/api/src/lib/liveness.ts `toEpochMs` — keep
 * the two in sync. Strings that already carry a zone (or a 'T') are passed through unchanged.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null} epoch ms, or null if unparseable
 */
export function toEpochMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  // Naive "YYYY-MM-DD HH:MM:SS" (no zone) ⇒ UTC: append Z. Otherwise just space→T (zone preserved).
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s.replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Best-effort OS process-detection (FRW-BL-063 ISC-1 process-detection leg). Returns:
 *   - true  : a process with `pid` is currently alive
 *   - false : `pid` is a valid pid but NO such process exists (dead → strong stall signal)
 *   - undefined : detection could not be performed (no/invalid pid, or the probe itself failed) →
 *                 caller MUST fall back to mtime classification, NOT treat as dead.
 * NEVER throws. Deterministic only insofar as the OS is — inject this in tests.
 *
 * POSIX: `process.kill(pid, 0)` sends no signal but does the permission/existence check (ESRCH =
 * gone, EPERM = exists-but-not-ours → alive). Windows: `process.kill(pid, 0)` is unreliable, so we
 * shell out to `tasklist /FI "PID eq <pid>"` and look for the pid in the output.
 *
 * @param {number|string|null|undefined} pid
 * @param {string} [platform] override process.platform (tests)
 * @returns {boolean|undefined}
 */
export function processAlive(pid, platform = process.platform) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return undefined; // no usable pid → unknown
  if (platform === 'win32') {
    try {
      // node:child_process is built-in; require lazily so the pure core stays import-free until used.
      const { execSync } = require('node:child_process');
      const out = String(
        execSync(`tasklist /FI "PID eq ${n}" /NH /FO CSV`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }),
      );
      // tasklist prints a CSV row containing the pid when found; "INFO: No tasks" / empty when not.
      if (/no tasks/i.test(out)) return false;
      return new RegExp(`"${n}"`).test(out) ? true : false;
    } catch {
      return undefined; // probe failed (tasklist missing / blocked) → unknown, fall back to mtime
    }
  }
  // POSIX (and anything non-win32): signal 0 = existence/permission probe, sends nothing.
  try {
    process.kill(n, 0);
    return true; // no throw ⇒ process exists and we may signal it
  } catch (err) {
    if (err && err.code === 'EPERM') return true;  // exists but not ours ⇒ alive
    if (err && err.code === 'ESRCH') return false; // no such process ⇒ dead
    return undefined; // anything else (e.g. invalid on this platform) ⇒ unknown
  }
}

/**
 * Resolve the agent's last-activity timestamp (epoch ms) from whatever signal is available.
 * Preference order — the freshest / most-specific signal wins:
 *   1. `lastActivityMs` (caller already computed it; e.g. max of log/heartbeat/event mtimes)
 *   2. `heartbeatMs` (an explicit heartbeat write)
 *   3. `updatedAt` / `startedAt` parsed to epoch ms (DB columns)
 * Returns null if nothing usable is present.
 *
 * @param {object} agent
 * @returns {number|null} epoch ms of last activity, or null
 */
export function resolveLastActivityMs(agent = {}) {
  const candidates = [];
  if (typeof agent.lastActivityMs === 'number' && Number.isFinite(agent.lastActivityMs)) {
    candidates.push(agent.lastActivityMs);
  }
  if (typeof agent.heartbeatMs === 'number' && Number.isFinite(agent.heartbeatMs)) {
    candidates.push(agent.heartbeatMs);
  }
  for (const field of ['heartbeatAt', 'updatedAt', 'lastEventAt', 'startedAt']) {
    const v = agent[field];
    if (v == null) continue;
    // toEpochMs treats naive "YYYY-MM-DD HH:MM:SS" as UTC (matches the SQLite/API twin), avoiding
    // the local-time misparse that previously diverged from liveness.ts toEpochMs.
    const ms = toEpochMs(v);
    if (ms != null && Number.isFinite(ms)) candidates.push(ms);
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/**
 * Classify an agent's liveness as 'working' | 'idle' | 'stalled'. PURE — `now` is injected.
 *
 * @param {{status?: string, lastActivityMs?: number, heartbeatMs?: number,
 *          heartbeatAt?: string|number, updatedAt?: string|number,
 *          lastEventAt?: string|number, startedAt?: string|number,
 *          pid?: number|string, processAlive?: boolean}} agent
 *   `processAlive` (optional) is a pre-computed OS process-detection result: true = process found,
 *   false = process gone, undefined = detection unavailable (fall back to mtime only). `pid`
 *   (optional) is the agent's OS pid: when present and no explicit processAlive is supplied, the
 *   real `processAlive(pid)` detector is run (a DEAD pid forces 'stalled'; a live/unknown pid falls
 *   through to mtime). Inject `opts.processDetector` in tests to keep this deterministic.
 * @param {number} now current time in epoch ms (REQUIRED — no wall-clock inside the core)
 * @param {{workingMs?: number, stalledMs?: number, processAlive?: boolean,
 *          processDetector?: (pid: number|string) => (boolean|undefined)}} [opts]
 *   thresholds (default LIVENESS_DEFAULTS); `opts.processAlive` overrides everything; otherwise
 *   `agent.processAlive`; otherwise, if `agent.pid` is set, `opts.processDetector ?? processAlive`
 *   is invoked. `opts.processDetector` lets tests inject a deterministic detector.
 * @returns {'working'|'idle'|'stalled'}
 */
export function classifyLiveness(agent = {}, now, opts = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('classifyLiveness: `now` (epoch ms) must be provided as a finite number');
  }
  const workingMs = opts.workingMs ?? LIVENESS_DEFAULTS.workingMs;
  const stalledMs = opts.stalledMs ?? LIVENESS_DEFAULTS.stalledMs;

  const status = String(agent.status ?? 'running').toLowerCase();
  const isTerminal = TERMINAL_STATUSES.includes(status);

  // A finished agent is never 'stalled' — no liveness concern. Report 'idle'.
  if (isTerminal) return 'idle';

  // Process detection is the strongest stall signal for a running agent: the process is gone but
  // the DB still says 'running' ⇒ stalled, regardless of mtime. Precedence:
  //   1. opts.processAlive (explicit caller override)
  //   2. agent.processAlive (pre-computed on the record)
  //   3. live probe of agent.pid via opts.processDetector ?? processAlive (best-effort, may be
  //      undefined → treated as "unavailable", falls through to mtime).
  let processAliveResult = opts.processAlive ?? agent.processAlive;
  if (processAliveResult === undefined && agent.pid != null) {
    const detector = opts.processDetector ?? processAlive;
    try {
      processAliveResult = detector(agent.pid);
    } catch {
      processAliveResult = undefined; // detector must never break classification
    }
  }
  if (processAliveResult === false) return 'stalled';

  const lastActivityMs = resolveLastActivityMs(agent);
  if (lastActivityMs == null) {
    // No activity signal at all. If the process is known-alive, treat as idle; otherwise we cannot
    // confirm it is working — a running agent with zero activity evidence is treated as idle (not
    // stalled: absence of mtime is not proof of a stall, only the stall threshold or a dead process
    // promotes to stalled).
    return 'idle';
  }

  const sinceActivity = now - lastActivityMs;
  // Clock skew / future timestamp guard: treat as just-now ⇒ working.
  if (sinceActivity < 0) return 'working';
  if (sinceActivity < workingMs) return 'working';
  if (sinceActivity >= stalledMs) return 'stalled';
  return 'idle';
}

/**
 * Convenience: classify a batch of agents at one `now`. Returns each agent annotated with its
 * computed `liveness`. Pure (now injected). Used by the dashboard agents route (ISC-2).
 *
 * @param {Array<object>} agents
 * @param {number} now epoch ms
 * @param {object} [opts] thresholds passed through to classifyLiveness
 * @returns {Array<object & {liveness: 'working'|'idle'|'stalled'}>}
 */
export function annotateLiveness(agents = [], now, opts = {}) {
  return (agents || []).map((a) => ({ ...a, liveness: classifyLiveness(a, now, opts) }));
}
