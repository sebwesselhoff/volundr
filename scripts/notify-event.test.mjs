// Self-test for notify-event.mjs (FRW-BL-063 ISC-3 — notifications actually FIRE).
// Run: node scripts/notify-event.test.mjs
import { notifyEvent, NOTIFY_EVENTS } from './notify-event.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('notify-event self-test\n');

// A writable sink that records what was written (stand-in for a TTY).
function makeSink() { const w = { written: [], write(s) { w.written.push(s); return true; } }; return w; }

// --- OFF BY DEFAULT: no config, empty env → skipped, NO side effects -------------------------
{
  const sink = makeSink();
  const calls = [];
  const r = await notifyEvent('project_complete', { foo: 1 }, {
    env: {}, sink, fetch: () => { calls.push('fetch'); return { ok: true }; },
    runCommand: () => { calls.push('cmd'); },
  });
  ok('off-by-default: skipped:true, fired:false', r.skipped === true && r.fired === false);
  ok('off-by-default: NO terminal write', sink.written.length === 0);
  ok('off-by-default: NO fetch / desktop call', calls.length === 0);
  ok('off-by-default: no channels', r.channels.length === 0);
}

// --- env says off explicitly → still skipped --------------------------------------------------
for (const v of ['off', 'none', '', '0', 'false']) {
  const sink = makeSink();
  const r = await notifyEvent('agent_stalled', {}, { env: { VLDR_NOTIFY: v }, sink });
  ok(`env VLDR_NOTIFY="${v}" → skipped, no write`, r.skipped === true && r.fired === false && sink.written.length === 0);
}

// --- each of the 4 event types DISPATCHES when enabled (injected channel asserts the call) ----
for (const ev of NOTIFY_EVENTS) {
  const sink = makeSink();
  const r = await notifyEvent(ev, { detail: ev }, { channels: ['terminal-bell'], sink });
  ok(`event '${ev}' dispatches (fired, BEL written, not skipped)`,
    r.fired === true && r.skipped === false && sink.written.length === 1 && sink.written[0] === '\x07');
}

// --- enabled via env (not just explicit config) ------------------------------------------------
{
  const sink = makeSink();
  const r = await notifyEvent('cost_gate_pause', { cost: 5 }, { env: { VLDR_NOTIFY: 'terminal-bell' }, sink });
  ok('enabled via env VLDR_NOTIFY=terminal-bell → fired', r.fired === true && sink.written[0] === '\x07');
}

// --- webhook path via injected fetch asserts the dispatch + payload ---------------------------
{
  let captured = null;
  const r = await notifyEvent('build_gate_fail', { cardId: 'C9', message: 'tsc failed' }, {
    channels: ['webhook'], webhookUrl: 'https://hooks.example/x',
    fetch: async (url, init) => { captured = { url, init }; return { ok: true, status: 200 }; },
  });
  ok('webhook: dispatched to configured URL', captured && captured.url === 'https://hooks.example/x');
  const body = JSON.parse(captured.init.body);
  ok('webhook: payload carries event type + detail', body.event === 'build_gate_fail' && body.payload.cardId === 'C9');
  ok('webhook: fired true', r.fired === true && r.skipped === false);
}

// --- explicit opts.config object honored (config wins over env) -------------------------------
{
  const sink = makeSink();
  const r = await notifyEvent('agent_stalled', {}, {
    config: { channels: ['terminal-bell'] }, env: { VLDR_NOTIFY: 'off' }, sink,
  });
  ok('opts.config.channels wins over env "off"', r.fired === true && sink.written[0] === '\x07');
}

// --- unknown event → silent no-op, never fires ------------------------------------------------
{
  const sink = makeSink();
  const r = await notifyEvent('not_an_event', {}, { channels: ['terminal-bell'], sink });
  ok('unknown event → skipped no-op (no write, no fire)', r.skipped === true && r.fired === false && sink.written.length === 0);
}

// --- NEVER THROWS even when the injected dispatcher blows up ----------------------------------
{
  const r = await notifyEvent('project_complete', {}, {
    channels: ['terminal-bell'],
    notify: async () => { throw new Error('dispatcher exploded'); },
  });
  ok('dispatcher throw is swallowed → error captured, no throw', r.fired === false && /exploded/.test(r.error || ''));
}
{
  // a synchronously-throwing notify is also caught
  let threw = false;
  try {
    const r = await notifyEvent('agent_stalled', {}, { channels: ['terminal-bell'], notify: () => { throw new Error('sync boom'); } });
    ok('sync-throwing dispatcher swallowed', r.fired === false && /boom/.test(r.error || ''));
  } catch { threw = true; }
  ok('notifyEvent never throws/rejects (sync-throw path)', threw === false);
}

// --- injected notify dispatcher is called with the right args when enabled --------------------
{
  let seen = null;
  const r = await notifyEvent('cost_gate_pause', { scopeId: 'card-1', spentTokens: 999 }, {
    channels: ['terminal-bell'],
    notify: async (ev, payload, cfg) => { seen = { ev, payload }; return { fired: true, channels: ['terminal-bell'], dispatched: [{ channel: 'terminal-bell', ok: true }] }; },
  });
  ok('injected dispatcher receives event + payload', seen && seen.ev === 'cost_gate_pause' && seen.payload.scopeId === 'card-1');
  ok('result reflects injected dispatcher fired', r.fired === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
