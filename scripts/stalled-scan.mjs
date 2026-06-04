#!/usr/bin/env node
/**
 * stalled-scan.mjs — the REAL agent_stalled emit site (FRW-BL-063 ISC-3 follow-up).
 *
 * agent-liveness.mjs can CLASSIFY an agent as stalled, and notify-event.mjs can FIRE a
 * notification, but nothing periodically looked at the live agent roster and connected the two.
 * This module is that scanner: fetch `/api/projects/:id/agents`, classify each RUNNING agent via
 * `classifyLiveness`, and `notifyEvent('agent_stalled', …)` for agents that are NEWLY stalled.
 *
 * DEDUPE: a stalled agent is reported AT MOST ONCE per run (per scanner instance). The set of
 * already-notified agent ids is held on the scanner so a 30s poll loop does not re-beep every tick
 * for the same stuck teammate. Use `createStalledScanner()` for a long-lived loop (keeps the
 * dedupe set across scans); `scanForStalled()` is the one-shot pure-ish core.
 *
 * DETERMINISTIC + INJECTABLE: `now`, `fetch`, and `notify` are all injectable, so tests never read
 * the wall clock, hit the network, or actually beep. Off-by-default is inherited from notifyEvent —
 * with no notify config, classification still runs but NO notification side effect occurs.
 *
 * Runnable: `node scripts/stalled-scan.mjs <projectId>` does a single live scan against
 * VLDR_API_URL (default http://localhost:3141). Pure ESM, no external deps.
 */

import { classifyLiveness, processAlive } from './agent-liveness.mjs';
import { notifyEvent as defaultNotifyEvent } from './notify-event.mjs';

const DEFAULT_API_URL = process.env.VLDR_API_URL || 'http://localhost:3141';

/** Statuses we actively monitor for stalls (RUNNING work only — terminal agents are never stalled). */
const MONITORED_STATUSES = new Set(['running', 'active', 'working', 'in_progress']);

/**
 * One-shot scan: classify the supplied agents and fire `agent_stalled` for each NEWLY-stalled
 * agent (i.e. stalled AND not already in `alreadyNotified`). Pure w.r.t. injected deps.
 *
 * @param {object} args
 * @param {Array<object>} args.agents agent records (id/status/pid/updatedAt/lastEventAt/…)
 * @param {number} args.now epoch ms (REQUIRED — injected; no wall clock here)
 * @param {Set<string>} [args.alreadyNotified] ids already notified this run (mutated: newly-stalled
 *        ids are added). Omit for a single isolated scan.
 * @param {object} [args.notifyOpts] passed straight to notifyEvent (config/channels/env/fetch/…).
 * @param {(eventType: string, payload: object, opts: object) => Promise<any>} [args.notify]
 *        dispatcher (default notify-event.notifyEvent). Injectable for tests.
 * @param {(agent: object, now: number, opts?: object) => string} [args.classify]
 *        classifier (default classifyLiveness). Injectable for tests.
 * @param {(pid: any) => (boolean|undefined)} [args.processDetector] injected into classify for
 *        deterministic process detection in tests.
 * @param {object} [args.opts] thresholds (workingMs/stalledMs) forwarded to classify.
 * @returns {Promise<{scanned: number, stalled: string[], notified: string[],
 *           results: Array<{id: string, liveness: string, notified: boolean}>}>}
 */
export async function scanForStalled({
  agents = [],
  now,
  alreadyNotified = new Set(),
  notifyOpts = {},
  notify = defaultNotifyEvent,
  classify = classifyLiveness,
  processDetector = processAlive,
  opts = {},
} = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('scanForStalled: `now` (epoch ms) must be provided as a finite number');
  }

  const stalled = [];
  const notified = [];
  const results = [];

  for (const agent of agents || []) {
    const status = String(agent?.status ?? 'running').toLowerCase();
    // Only monitor running-class agents — never beep for completed/failed/cancelled.
    if (!MONITORED_STATUSES.has(status)) {
      results.push({ id: agent?.id, liveness: 'idle', notified: false });
      continue;
    }

    const liveness = classify(agent, now, { ...opts, processDetector });
    let didNotify = false;

    if (liveness === 'stalled') {
      stalled.push(agent.id);
      // Dedupe: only fire for agents NOT already notified this run.
      if (!alreadyNotified.has(agent.id)) {
        alreadyNotified.add(agent.id);
        // notifyEvent NEVER throws; off-by-default config → no side effect.
        await notify(
          'agent_stalled',
          {
            agentId: agent.id,
            name: agent.name ?? agent.role ?? null,
            projectId: agent.projectId ?? null,
            message: `Agent ${agent.name ?? agent.id} appears stalled (no activity past threshold)`,
            ts: new Date(now).toISOString(),
          },
          notifyOpts,
        );
        didNotify = true;
        notified.push(agent.id);
      }
    }
    results.push({ id: agent.id, liveness, notified: didNotify });
  }

  return { scanned: (agents || []).length, stalled, notified, results };
}

/**
 * Long-lived scanner: keeps a dedupe set across repeated `scan()` calls so a poll loop reports each
 * stalled agent only once. `fetchAgents` (injectable) returns the agent roster; default hits the
 * dashboard API. `now` (injectable) defaults to Date.now at scan time.
 *
 * @param {object} [config]
 * @param {string} [config.projectId] project to scan (for the default API fetcher).
 * @param {string} [config.apiUrl] dashboard API base (default VLDR_API_URL).
 * @param {(projectId: string) => Promise<Array<object>>} [config.fetchAgents] roster fetcher.
 * @param {Function} [config.fetch] fetch impl for the default fetcher (default global fetch).
 * @param {object} [config.notifyOpts] forwarded to notifyEvent (config/channels/env/…).
 * @param {Function} [config.notify] dispatcher (default notify-event.notifyEvent).
 * @param {object} [config.opts] thresholds forwarded to classifyLiveness.
 * @returns {{ scan: (overrides?: {now?: number}) => Promise<object>, reset: () => void,
 *             notifiedIds: () => string[] }}
 */
export function createStalledScanner(config = {}) {
  const {
    projectId,
    apiUrl = DEFAULT_API_URL,
    fetchAgents,
    fetch: fetchImpl,
    notifyOpts = {},
    notify = defaultNotifyEvent,
    opts = {},
  } = config;

  const alreadyNotified = new Set();

  const defaultFetchAgents = async (pid) => {
    const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!doFetch || !pid) return [];
    try {
      const res = await doFetch(`${apiUrl}/api/projects/${pid}/agents`, {
        ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(4000) } : {}),
      });
      if (!res || (res.ok === false)) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data && Array.isArray(data.agents) ? data.agents : []);
    } catch {
      return []; // best-effort: a fetch failure must never crash the scanner
    }
  };

  const fetcher = fetchAgents ?? defaultFetchAgents;

  return {
    async scan(overrides = {}) {
      const now = typeof overrides.now === 'number' ? overrides.now : Date.now();
      let agents = [];
      try {
        agents = (await fetcher(projectId)) || [];
      } catch {
        agents = []; // never throw out of scan
      }
      return scanForStalled({ agents, now, alreadyNotified, notifyOpts, notify, opts });
    },
    reset() { alreadyNotified.clear(); },
    notifiedIds() { return [...alreadyNotified]; },
  };
}

// Runnable: `node scripts/stalled-scan.mjs <projectId>` — single live scan, prints a summary.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('stalled-scan.mjs')) {
  const projectId = process.argv[2] || process.env.VLDR_PROJECT_ID;
  if (!projectId) {
    console.error('usage: node scripts/stalled-scan.mjs <projectId>  (or set VLDR_PROJECT_ID)');
    process.exit(0); // never-fail: this is best-effort tooling
  }
  const scanner = createStalledScanner({ projectId });
  scanner
    .scan()
    .then((r) => {
      console.log(JSON.stringify({ scanned: r.scanned, stalled: r.stalled, notified: r.notified }, null, 2));
      process.exit(0);
    })
    .catch(() => process.exit(0));
}
