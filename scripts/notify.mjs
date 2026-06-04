#!/usr/bin/env node
/**
 * notify.mjs — event-driven operator notifications (FRW-BL-063 ISC-3, absorbs FRW-BL-042 ISC3/4)
 *
 * A long autonomous run needs to grab the operator's attention on a small set of IMPORTANT events
 * — a cost gate paused the run, a build gate failed, the whole project completed, or an agent has
 * stalled (see agent-liveness.mjs). This module dispatches those events to a configurable set of
 * channels.
 *
 * CHANNELS (all OFF BY DEFAULT — ISC-4):
 *   - terminal-bell : write the terminal BEL control char (\x07) to a TTY sink (FRW-BL-042 ISC3).
 *   - desktop       : best-effort native OS notification via a documented per-platform command
 *                     (macOS: osascript, Windows: PowerShell toast/balloon, Linux: notify-send).
 *                     NEVER throws if the tool is missing — degrades silently.
 *   - webhook       : POST a JSON payload to a configured URL. Best-effort; never throws.
 *
 * EVENTS (the only types that fire): cost_gate_pause | build_gate_fail | project_complete |
 * agent_stalled. An unknown event type is ignored (returns dispatched: []).
 *
 * DESIGN: everything that touches the outside world is INJECTABLE so tests never actually beep,
 * spawn a process, or POST: `config.sink` (terminal-bell target, default process.stdout),
 * `config.fetch` (webhook, default global fetch), `config.runCommand` (desktop, default a real
 * child_process spawn). `notify` is async and resolves to a structured result — it never throws
 * (a channel failure is captured per-channel), so a notification can never crash the run.
 *
 * Pure-ish Node (no external deps; node:child_process only used by the DEFAULT desktop runner,
 * which tests override). Self-test: scripts/notify.test.mjs.
 *
 * ── CONFIGURATION (OFF BY DEFAULT — ISC-4) ──────────────────────────────────────────────────
 * Enabled via environment variables (declared in .claude/settings.json `env`, both empty/off by
 * default — set them to opt in):
 *   VLDR_NOTIFY          comma-separated channels to enable, e.g. "terminal-bell,desktop,webhook".
 *                        Empty string / "off" / "none" / "0" / "false" ⇒ ALL channels OFF (default).
 *   VLDR_NOTIFY_WEBHOOK  webhook target URL (required only when the "webhook" channel is enabled).
 * A caller may also pass an explicit `config` object (config.channels / config.webhookUrl), which
 * takes precedence over the environment — see resolveNotifyConfig.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

/** The only event types that trigger a notification. */
export const NOTIFY_EVENTS = Object.freeze([
  'cost_gate_pause',
  'build_gate_fail',
  'project_complete',
  'agent_stalled',
]);

/** Known channel names. */
export const NOTIFY_CHANNELS = Object.freeze(['terminal-bell', 'desktop', 'webhook']);

/** Terminal BEL control character (rings the terminal / flashes on most emulators). */
export const BEL = '\x07';

/** Human-readable one-liners per event, used for desktop/webhook message bodies. */
const EVENT_TITLES = Object.freeze({
  cost_gate_pause: 'Volundr: cost gate paused the run',
  build_gate_fail: 'Volundr: build gate failed',
  project_complete: 'Volundr: project complete',
  agent_stalled: 'Volundr: an agent has stalled',
});

/**
 * Parse the enabled-channels list + webhook URL from config and/or environment. DEFAULT OFF: with
 * no config and no env, NO channels are enabled. Sources (config wins over env):
 *   - config.channels: array of channel names, OR a comma string, OR { 'terminal-bell': true, … }
 *   - env.VLDR_NOTIFY: comma-separated channel names (e.g. "terminal-bell,webhook"); "off"/"none"/""
 *     ⇒ no channels.
 *   - config.webhookUrl / env.VLDR_NOTIFY_WEBHOOK: webhook target URL.
 *
 * @param {object} [config]
 * @param {Record<string,string|undefined>} [env] defaults to process.env
 * @returns {{channels: string[], webhookUrl: string|null}}
 */
export function resolveNotifyConfig(config = {}, env = process.env) {
  let channels = [];

  if (config.channels != null) {
    if (Array.isArray(config.channels)) {
      channels = config.channels.slice();
    } else if (typeof config.channels === 'string') {
      channels = config.channels.split(',');
    } else if (typeof config.channels === 'object') {
      channels = Object.entries(config.channels).filter(([, v]) => v === true).map(([k]) => k);
    }
  } else {
    const raw = env && env.VLDR_NOTIFY;
    if (raw && !/^(off|none|0|false)$/i.test(raw.trim())) {
      channels = String(raw).split(',');
    }
  }

  // Normalize, dedupe, and keep only known channels.
  channels = [...new Set(channels.map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
    .filter((c) => NOTIFY_CHANNELS.includes(c));

  const webhookUrl = config.webhookUrl ?? (env && env.VLDR_NOTIFY_WEBHOOK) ?? null;

  return { channels, webhookUrl: webhookUrl || null };
}

/**
 * Build the default per-platform desktop-notification command (documented, best-effort). Returns
 * null on an unknown platform so the desktop channel degrades to a no-op rather than throwing.
 *   macOS   : osascript -e 'display notification "<body>" with title "<title>"'
 *   Windows : powershell -Command (balloon tip via System.Windows.Forms.NotifyIcon)
 *   Linux   : notify-send "<title>" "<body>"
 *
 * @param {string} title
 * @param {string} body
 * @param {string} [platform] defaults to process.platform
 * @returns {{cmd: string, args: string[]}|null}
 */
export function buildDesktopCommand(title, body, platform = process.platform) {
  const t = String(title);
  const b = String(body);
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-e', `display notification ${JSON.stringify(b)} with title ${JSON.stringify(t)}`] };
  }
  if (platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$n = New-Object System.Windows.Forms.NotifyIcon;',
      '$n.Icon = [System.Drawing.SystemIcons]::Information;',
      '$n.Visible = $true;',
      `$n.ShowBalloonTip(5000, ${JSON.stringify(t)}, ${JSON.stringify(b)}, [System.Windows.Forms.ToolTipIcon]::Info);`,
    ].join(' ');
    return { cmd: 'powershell', args: ['-NoProfile', '-Command', ps] };
  }
  if (platform === 'linux') {
    return { cmd: 'notify-send', args: [t, b] };
  }
  return null; // unknown platform — best-effort no-op
}

/** Default desktop runner: spawn the OS command detached, swallow every error. Never throws. */
async function defaultRunCommand(cmd, args) {
  const { spawn } = await import('node:child_process');
  await new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
      child.on('error', () => resolve(undefined)); // tool missing ⇒ ENOENT ⇒ swallow
      child.on('close', () => resolve(undefined));
      // Don't block the run on the notifier.
      if (typeof child.unref === 'function') child.unref();
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Fire a notification for an event across the configured channels. OFF BY DEFAULT. Never throws.
 *
 * @param {string} event one of NOTIFY_EVENTS (others are ignored)
 * @param {object} [payload] arbitrary structured detail (cost, cardId, agentId, message, …)
 * @param {object} [config] {
 *     channels?, webhookUrl?,        // see resolveNotifyConfig
 *     env?,                          // env source (default process.env)
 *     sink?,                         // terminal-bell target (default process.stdout); needs .write
 *     fetch?,                        // webhook fetch impl (default global fetch)
 *     runCommand?,                   // desktop runner (cmd,args)=>Promise (default real spawn)
 *     platform?,                     // override process.platform for desktop command building
 *     terminalSequence?,             // override the BEL string written by terminal-bell
 *   }
 * @returns {Promise<{event: string, fired: boolean, channels: string[],
 *           dispatched: Array<{channel: string, ok: boolean, detail?: string}>}>}
 */
export async function notify(event, payload = {}, config = {}) {
  const env = config.env ?? process.env;
  const { channels, webhookUrl } = resolveNotifyConfig(config, env);

  // Ignore unknown events and the OFF state (no enabled channels) up front.
  if (!NOTIFY_EVENTS.includes(event)) {
    return { event, fired: false, channels: [], dispatched: [] };
  }
  if (channels.length === 0) {
    return { event, fired: false, channels: [], dispatched: [] };
  }

  const title = EVENT_TITLES[event] ?? `Volundr: ${event}`;
  const body = typeof payload?.message === 'string' && payload.message
    ? payload.message
    : `${event} ${JSON.stringify(payload ?? {})}`;

  const dispatched = [];

  for (const channel of channels) {
    try {
      if (channel === 'terminal-bell') {
        const sink = config.sink ?? process.stdout;
        const seq = config.terminalSequence ?? BEL;
        if (sink && typeof sink.write === 'function') {
          sink.write(seq);
          dispatched.push({ channel, ok: true });
        } else {
          dispatched.push({ channel, ok: false, detail: 'no writable sink' });
        }
      } else if (channel === 'webhook') {
        if (!webhookUrl) {
          dispatched.push({ channel, ok: false, detail: 'no webhook url configured' });
          continue;
        }
        const doFetch = config.fetch ?? (typeof fetch === 'function' ? fetch : null);
        if (!doFetch) {
          dispatched.push({ channel, ok: false, detail: 'no fetch available' });
          continue;
        }
        const res = await doFetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, title, payload: payload ?? {}, ts: payload?.ts ?? null }),
        });
        const okFlag = res && (res.ok === undefined ? true : !!res.ok);
        dispatched.push({ channel, ok: !!okFlag, ...(res && res.status != null ? { detail: `status ${res.status}` } : {}) });
      } else if (channel === 'desktop') {
        const cmd = buildDesktopCommand(title, body, config.platform ?? process.platform);
        if (!cmd) {
          dispatched.push({ channel, ok: false, detail: 'unsupported platform (no-op)' });
          continue;
        }
        const runCommand = config.runCommand ?? defaultRunCommand;
        await runCommand(cmd.cmd, cmd.args);
        dispatched.push({ channel, ok: true });
      }
    } catch (err) {
      // Best-effort: a channel failure NEVER propagates — capture and move on.
      dispatched.push({ channel, ok: false, detail: String(err && err.message ? err.message : err) });
    }
  }

  return { event, fired: dispatched.some((d) => d.ok), channels, dispatched };
}
