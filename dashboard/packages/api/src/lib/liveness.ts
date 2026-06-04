/**
 * liveness.ts — stalled-agent liveness classification for the dashboard API (FRW-BL-063 ISC-2).
 *
 * This is the TypeScript twin of `scripts/agent-liveness.mjs` (the pure-node testable core). The
 * scripts/*.mjs core lives outside the API package's rootDir (./src), so we re-state the SAME
 * deterministic classification here (now injected, no wall-clock in the core) for the
 * GET /projects/:projectId/agents route. Keep the two in sync.
 *
 *   - A terminal agent (completed/failed/timeout/cancelled) is NEVER 'stalled' → 'idle'.
 *   - Activity within workingMs        → 'working'
 *   - Activity older than stalledMs    → 'stalled' (while still running)
 *   - In between                       → 'idle'
 */

export type Liveness = 'working' | 'idle' | 'stalled';

export const LIVENESS_DEFAULTS = {
  /** Activity newer than this ⇒ working. */
  workingMs: 30_000,
  /** No activity for at least this long (while running) ⇒ stalled. Default 5 min. */
  stalledMs: 5 * 60_000,
} as const;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timeout', 'cancelled']);

export interface LivenessAgent {
  status?: string | null;
  /** epoch ms of last observed activity, if the caller already computed it. */
  lastActivityMs?: number | null;
  /** SQLite "YYYY-MM-DD HH:MM:SS" or ISO timestamp of last activity / start. */
  startedAt?: string | null;
  /** OS process-detection result: true=alive, false=gone, undefined=unavailable. */
  processAlive?: boolean;
}

export interface LivenessOpts {
  workingMs?: number;
  stalledMs?: number;
  processAlive?: boolean;
}

/** Parse a SQLite/ISO timestamp string (or number) to epoch ms; null if unparseable. */
export function toEpochMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" (UTC, no zone). Normalize to ISO-UTC.
  const s = String(value).trim();
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s.replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Classify one agent's liveness. PURE — `now` (epoch ms) is injected.
 */
export function classifyLiveness(agent: LivenessAgent, now: number, opts: LivenessOpts = {}): Liveness {
  const workingMs = opts.workingMs ?? LIVENESS_DEFAULTS.workingMs;
  const stalledMs = opts.stalledMs ?? LIVENESS_DEFAULTS.stalledMs;

  const status = String(agent.status ?? 'running').toLowerCase();
  if (TERMINAL_STATUSES.has(status)) return 'idle';

  const processAlive = opts.processAlive ?? agent.processAlive;
  if (processAlive === false) return 'stalled';

  const lastActivityMs = agent.lastActivityMs ?? toEpochMs(agent.startedAt);
  if (lastActivityMs == null) return 'idle';

  const sinceActivity = now - lastActivityMs;
  if (sinceActivity < 0) return 'working';
  if (sinceActivity < workingMs) return 'working';
  if (sinceActivity >= stalledMs) return 'stalled';
  return 'idle';
}
