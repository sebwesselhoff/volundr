// Self-test for notify.mjs (FRW-BL-063 ISC-3 / FRW-BL-042 ISC3-4). Run: node scripts/notify.test.mjs
import {
  notify,
  resolveNotifyConfig,
  buildDesktopCommand,
  NOTIFY_EVENTS,
  NOTIFY_CHANNELS,
  BEL,
} from './notify.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('notify self-test\n');

// A writable sink that records what was written (stand-in for a TTY).
function makeSink() { const w = { written: [], write(s) { w.written.push(s); return true; } }; return w; }

// --- DEFAULT OFF: no config, no env → no channel fires -----------------------
{
  const sink = makeSink();
  const calls = [];
  const r = await notify('project_complete', { foo: 1 }, {
    env: {}, sink, fetch: () => { calls.push('fetch'); return { ok: true }; },
    runCommand: () => { calls.push('cmd'); },
  });
  ok('default OFF: no channels enabled → fired false', r.fired === false && r.channels.length === 0);
  ok('default OFF: terminal sink untouched', sink.written.length === 0);
  ok('default OFF: no fetch/desktop calls', calls.length === 0);
  ok('default OFF: dispatched empty', r.dispatched.length === 0);
}

// --- env VLDR_NOTIFY="off"/"none"/"" → still OFF ----------------------------
for (const v of ['off', 'none', '', '0', 'false', 'OFF']) {
  const r = resolveNotifyConfig({}, { VLDR_NOTIFY: v });
  ok(`env VLDR_NOTIFY="${v}" → no channels`, r.channels.length === 0);
}

// --- terminal-bell writes BEL to injected sink ------------------------------
{
  const sink = makeSink();
  const r = await notify('agent_stalled', { agentId: 'x' }, { channels: ['terminal-bell'], sink });
  ok('terminal-bell: writes BEL (\\x07) to injected sink', sink.written.length === 1 && sink.written[0] === BEL);
  ok('terminal-bell: BEL constant is \\x07', BEL === '\x07' && BEL.charCodeAt(0) === 7);
  ok('terminal-bell: fired true + dispatched ok', r.fired === true && r.dispatched[0].channel === 'terminal-bell' && r.dispatched[0].ok === true);
}
{
  // custom terminalSequence override
  const sink = makeSink();
  await notify('build_gate_fail', {}, { channels: ['terminal-bell'], sink, terminalSequence: '\x07\x07' });
  ok('terminal-bell: terminalSequence override honored', sink.written[0] === '\x07\x07');
}

// --- webhook uses injected fetch + asserts payload --------------------------
{
  let captured = null;
  const fakeFetch = async (url, init) => { captured = { url, init }; return { ok: true, status: 200 }; };
  const r = await notify('cost_gate_pause', { cost: 12.5, cardId: 'C1' }, {
    channels: ['webhook'], webhookUrl: 'https://hooks.example/x', fetch: fakeFetch,
  });
  ok('webhook: POSTs to configured URL', captured && captured.url === 'https://hooks.example/x');
  ok('webhook: method POST + JSON content-type', captured.init.method === 'POST' && captured.init.headers['content-type'] === 'application/json');
  const sentBody = JSON.parse(captured.init.body);
  ok('webhook: payload carries event type', sentBody.event === 'cost_gate_pause');
  ok('webhook: payload carries original payload (cost/cardId)', sentBody.payload.cost === 12.5 && sentBody.payload.cardId === 'C1');
  ok('webhook: dispatched ok with status detail', r.fired === true && r.dispatched[0].ok === true && /200/.test(r.dispatched[0].detail));
}
{
  // webhook enabled but no URL → not fired, no throw
  const r = await notify('project_complete', {}, { channels: ['webhook'], fetch: async () => ({ ok: true }) });
  ok('webhook: enabled but no URL → not fired, no throw', r.fired === false && r.dispatched[0].ok === false);
}
{
  // webhook fetch throws → captured per-channel, never propagates
  const r = await notify('agent_stalled', {}, {
    channels: ['webhook'], webhookUrl: 'https://x', fetch: async () => { throw new Error('network down'); },
  });
  ok('webhook: fetch throw is caught (never propagates)', r.dispatched[0].ok === false && /network down/.test(r.dispatched[0].detail));
}

// --- desktop: never throws on missing tool / unsupported platform -----------
{
  // injected runCommand that simulates a missing tool by resolving (default runner swallows ENOENT)
  let ran = null;
  const r = await notify('project_complete', { message: 'all done' }, {
    channels: ['desktop'], platform: 'linux', runCommand: async (cmd, args) => { ran = { cmd, args }; },
  });
  ok('desktop: builds notify-send command on linux', ran && ran.cmd === 'notify-send' && ran.args[0].includes('project complete'));
  ok('desktop: dispatched ok (best-effort)', r.dispatched[0].channel === 'desktop' && r.dispatched[0].ok === true);
}
{
  // unsupported platform → no-op, no throw, not ok
  const r = await notify('project_complete', {}, { channels: ['desktop'], platform: 'sunos', runCommand: async () => { throw new Error('should not run'); } });
  ok('desktop: unsupported platform → no-op (no throw, not ok)', r.dispatched[0].ok === false && /unsupported/.test(r.dispatched[0].detail));
}
{
  // runCommand itself throws → caught, never propagates
  const r = await notify('build_gate_fail', {}, { channels: ['desktop'], platform: 'darwin', runCommand: async () => { throw new Error('spawn EACCES'); } });
  ok('desktop: runCommand throw is caught (never propagates)', r.dispatched[0].ok === false && /EACCES/.test(r.dispatched[0].detail));
}

// --- only configured channels fire (selective) ------------------------------
{
  const sink = makeSink();
  let fetched = false;
  const r = await notify('cost_gate_pause', {}, {
    channels: ['terminal-bell'], sink, webhookUrl: 'https://x', fetch: async () => { fetched = true; return { ok: true }; },
  });
  ok('selective: only terminal-bell fires, webhook NOT called', sink.written.length === 1 && fetched === false && r.channels.length === 1);
}
{
  // multiple channels at once
  const sink = makeSink();
  let fetched = false;
  const r = await notify('agent_stalled', {}, {
    channels: ['terminal-bell', 'webhook'], sink, webhookUrl: 'https://x', fetch: async () => { fetched = true; return { ok: true, status: 204 }; },
  });
  ok('multi: both terminal-bell + webhook fire', sink.written.length === 1 && fetched === true && r.dispatched.length === 2 && r.fired === true);
}

// --- unknown event ignored --------------------------------------------------
{
  const sink = makeSink();
  const r = await notify('something_else', {}, { channels: ['terminal-bell'], sink });
  ok('unknown event → ignored (no fire, no write)', r.fired === false && r.dispatched.length === 0 && sink.written.length === 0);
}

// --- all four required event types fire when enabled ------------------------
for (const ev of NOTIFY_EVENTS) {
  const sink = makeSink();
  const r = await notify(ev, {}, { channels: ['terminal-bell'], sink });
  ok(`event '${ev}' fires terminal-bell`, r.fired === true && sink.written[0] === BEL);
}

// --- resolveNotifyConfig forms ----------------------------------------------
ok('config.channels array → parsed', resolveNotifyConfig({ channels: ['webhook'] }, {}).channels.join() === 'webhook');
ok('config.channels comma-string → parsed', resolveNotifyConfig({ channels: 'terminal-bell, webhook' }, {}).channels.join() === 'terminal-bell,webhook');
ok('config.channels object map → only true ones', resolveNotifyConfig({ channels: { 'terminal-bell': true, webhook: false, desktop: true } }, {}).channels.sort().join() === 'desktop,terminal-bell');
ok('env VLDR_NOTIFY comma list → parsed', resolveNotifyConfig({}, { VLDR_NOTIFY: 'webhook,desktop' }).channels.sort().join() === 'desktop,webhook');
ok('unknown channel names filtered out', resolveNotifyConfig({ channels: ['bogus', 'webhook'] }, {}).channels.join() === 'webhook');
ok('config wins over env', resolveNotifyConfig({ channels: ['terminal-bell'] }, { VLDR_NOTIFY: 'webhook' }).channels.join() === 'terminal-bell');
ok('webhookUrl from env VLDR_NOTIFY_WEBHOOK', resolveNotifyConfig({}, { VLDR_NOTIFY_WEBHOOK: 'https://e/h' }).webhookUrl === 'https://e/h');
ok('NOTIFY_CHANNELS shape', NOTIFY_CHANNELS.join() === 'terminal-bell,desktop,webhook');

// --- buildDesktopCommand per platform ---------------------------------------
ok('buildDesktopCommand darwin → osascript', buildDesktopCommand('T', 'B', 'darwin').cmd === 'osascript');
ok('buildDesktopCommand win32 → powershell', buildDesktopCommand('T', 'B', 'win32').cmd === 'powershell');
ok('buildDesktopCommand linux → notify-send', buildDesktopCommand('T', 'B', 'linux').cmd === 'notify-send');
ok('buildDesktopCommand unknown platform → null', buildDesktopCommand('T', 'B', 'plan9') === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
