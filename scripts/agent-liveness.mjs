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
    const ms = typeof v === 'number' ? v : Date.parse(String(v).replace(' ', 'T'));
    if (Number.isFinite(ms)) candidates.push(ms);
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
 *          processAlive?: boolean}} agent
 *   `processAlive` (optional) is the result of OS process detection: true = process found,
 *   false = process gone, undefined = detection unavailable (fall back to mtime only).
 * @param {number} now current time in epoch ms (REQUIRED — no wall-clock inside the core)
 * @param {{workingMs?: number, stalledMs?: number, processAlive?: boolean}} [opts]
 *   thresholds (default LIVENESS_DEFAULTS); `opts.processAlive` overrides `agent.processAlive`.
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

  // Process detection (when supplied) is the strongest stall signal for a running agent:
  // the process is gone but the DB still says 'running' ⇒ stalled, regardless of mtime.
  const processAlive = opts.processAlive ?? agent.processAlive;
  if (processAlive === false) return 'stalled';

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
