#!/usr/bin/env node
/**
 * notify-event.mjs — the thin, NEVER-THROWS dispatcher that ACTUALLY FIRES operator notifications
 * (FRW-BL-063 ISC-3 follow-up).
 *
 * notify.mjs is the channel engine (terminal-bell / desktop / webhook), but BEFORE this module
 * nothing in the run actually called it on real events — so notifications never fired. This wrapper
 * closes that gap: it is the single entry point that every real emit site calls. It:
 *
 *   1. Resolves the OFF-BY-DEFAULT config from an explicit `opts.config` and/or the environment
 *      (VLDR_NOTIFY / VLDR_NOTIFY_WEBHOOK) via notify.mjs's own resolveNotifyConfig. With NO config
 *      and NO env, NO channel is enabled → it returns `{ fired:false, skipped:true }` and does
 *      ABSOLUTELY NOTHING (no fetch, no spawn, no write). This is the off-by-default guarantee.
 *   2. When at least one channel is enabled, dispatches the event via notify.mjs (await-able).
 *   3. NEVER THROWS and NEVER REJECTS — every error (bad event, dispatch failure, even a broken
 *      injected impl) is swallowed and reported in the result. Callers in fire-and-forget hooks can
 *      therefore do `import(...).then(m => m.notifyEvent(...)).catch(() => {})` without any risk of
 *      blocking or crashing the hook.
 *
 * EVERYTHING that touches the outside world is injectable (passed straight through to notify.mjs):
 * `opts.channels`, `opts.webhookUrl`, `opts.env`, `opts.sink`, `opts.fetch`, `opts.runCommand`,
 * `opts.platform`, `opts.notify` (override the dispatcher itself — used by tests/wiring units).
 *
 * Pure-ish ESM, no external deps. Self-test: scripts/notify-event.test.mjs.
 */

import { notify as defaultNotify, resolveNotifyConfig, NOTIFY_EVENTS } from './notify.mjs';

/**
 * Fire a notification for one event — config-gated, best-effort, NEVER throws.
 *
 * @param {string} eventType one of NOTIFY_EVENTS (cost_gate_pause | build_gate_fail |
 *   project_complete | agent_stalled). Unknown types are a silent no-op.
 * @param {object} [payload] arbitrary structured detail (cost, cardId, agentId, message, …).
 * @param {object} [opts] {
 *     config?,        // explicit config object (channels/webhookUrl) — wins over env (see notify.mjs)
 *     env?,           // env source for VLDR_NOTIFY / VLDR_NOTIFY_WEBHOOK (default process.env)
 *     channels?, webhookUrl?, sink?, fetch?, runCommand?, platform?, terminalSequence?, // → notify.mjs
 *     notify?,        // override the dispatcher (default notify.mjs `notify`) — for tests/units
 *   }
 * @returns {Promise<{event: string, fired: boolean, skipped: boolean, channels: string[],
 *           dispatched?: Array<object>, error?: string}>}
 *   `skipped:true` means OFF (no channel enabled) — nothing was attempted. `fired` reflects whether
 *   any channel succeeded. `error` is set ONLY if the dispatcher itself blew up (still no throw).
 */
export async function notifyEvent(eventType, payload = {}, opts = {}) {
  try {
    // Unknown events: silent no-op (mirror notify.mjs's contract) — never even resolve channels.
    if (!NOTIFY_EVENTS.includes(eventType)) {
      return { event: eventType, fired: false, skipped: true, channels: [] };
    }

    // Build the config object notify.mjs / resolveNotifyConfig understands. An explicit
    // opts.config provides the BASE (channels/webhookUrl), and the loose top-level injectables
    // (sink/fetch/runCommand/platform/terminalSequence/channels/webhookUrl) are ALWAYS merged in so
    // a caller can pass `{ config: { channels }, sink }` and still have the sink/fetch reach the
    // channel engine (previously the explicit-config branch dropped them).
    const env = opts.env ?? process.env;
    const base = opts.config ? { ...opts.config } : {};
    const config = {
      ...base,
      env: base.env ?? env,
      ...(opts.channels != null ? { channels: opts.channels } : {}),
      ...(opts.webhookUrl != null ? { webhookUrl: opts.webhookUrl } : {}),
      ...(opts.sink != null ? { sink: opts.sink } : {}),
      ...(opts.fetch != null ? { fetch: opts.fetch } : {}),
      ...(opts.runCommand != null ? { runCommand: opts.runCommand } : {}),
      ...(opts.platform != null ? { platform: opts.platform } : {}),
      ...(opts.terminalSequence != null ? { terminalSequence: opts.terminalSequence } : {}),
    };

    // OFF-BY-DEFAULT gate: resolve channels FIRST and bail before any side effect when none enabled.
    const { channels } = resolveNotifyConfig(config, config.env);
    if (!channels || channels.length === 0) {
      return { event: eventType, fired: false, skipped: true, channels: [] };
    }

    const dispatch = opts.notify ?? defaultNotify;
    const result = await dispatch(eventType, payload ?? {}, config);
    return {
      event: eventType,
      fired: !!(result && result.fired),
      skipped: false,
      channels: (result && result.channels) || channels,
      dispatched: (result && result.dispatched) || [],
    };
  } catch (err) {
    // Absolute guarantee: never throw / reject. Surface the error in the result instead.
    return {
      event: eventType,
      fired: false,
      skipped: false,
      channels: [],
      error: String(err && err.message ? err.message : err),
    };
  }
}

export { NOTIFY_EVENTS } from './notify.mjs';
