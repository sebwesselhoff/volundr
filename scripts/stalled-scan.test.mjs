// Self-test for stalled-scan.mjs (FRW-BL-063 ISC-3 — agent_stalled actually fires).
// Run: node scripts/stalled-scan.test.mjs
import { scanForStalled, createStalledScanner } from './stalled-scan.mjs';
import { LIVENESS_DEFAULTS } from './agent-liveness.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('stalled-scan self-test\n');

const NOW = 1_000_000_000_000;
const { stalledMs } = LIVENESS_DEFAULTS;

// A recording notify dispatcher (stand-in for notify-event.notifyEvent).
function makeNotify() {
  const calls = [];
  const fn = async (eventType, payload, opts) => { calls.push({ eventType, payload, opts }); return { fired: true }; };
  fn.calls = calls;
  return fn;
}

// --- stalled agent fixture + enabled config + injected notify → agent_stalled FIRES -----------
{
  const notify = makeNotify();
  const agents = [
    { id: 'dev-1', status: 'running', lastActivityMs: NOW - stalledMs },     // stalled (mtime)
    { id: 'dev-2', status: 'running', lastActivityMs: NOW },                 // working
    { id: 'dev-3', status: 'completed', lastActivityMs: NOW - stalledMs },   // terminal → never stalled
  ];
  const r = await scanForStalled({ agents, now: NOW, notify, notifyOpts: { channels: ['terminal-bell'] } });
  ok('stalled-scan-fires: agent_stalled fired exactly once', notify.calls.length === 1 && notify.calls[0].eventType === 'agent_stalled');
  ok('stalled-scan-fires: fired for the stalled agent (dev-1)', notify.calls[0].payload.agentId === 'dev-1');
  ok('stalled-scan: result lists dev-1 as stalled+notified', r.stalled.includes('dev-1') && r.notified.includes('dev-1'));
  ok('stalled-scan: working agent NOT notified', !r.notified.includes('dev-2'));
  ok('stalled-scan: terminal agent NOT classified stalled', !r.stalled.includes('dev-3'));
  ok('stalled-scan: scanned count = 3', r.scanned === 3);
}

// --- dead process forces stalled (process-detection leg) via injected detector ----------------
{
  const notify = makeNotify();
  const agents = [{ id: 'dev-x', status: 'running', pid: 4242, lastActivityMs: NOW }]; // fresh mtime but dead pid
  const r = await scanForStalled({
    agents, now: NOW, notify, notifyOpts: { channels: ['terminal-bell'] },
    processDetector: () => false, // dead
  });
  ok('process-detection: dead pid → stalled fires despite fresh mtime', notify.calls.length === 1 && r.stalled.includes('dev-x'));
}

// --- all-healthy roster → NOTHING fires --------------------------------------------------------
{
  const notify = makeNotify();
  const agents = [
    { id: 'a', status: 'running', lastActivityMs: NOW },
    { id: 'b', status: 'running', lastActivityMs: NOW - 1000 },
  ];
  const r = await scanForStalled({ agents, now: NOW, notify, notifyOpts: { channels: ['terminal-bell'] } });
  ok('all-healthy: nothing fires', notify.calls.length === 0 && r.notified.length === 0 && r.stalled.length === 0);
}

// --- off-by-default: real notifyEvent path, no config → no side effect, no throw ---------------
{
  // Use the REAL notify-event dispatcher (default) with NO config → off. Inject a sink-spy via
  // notifyOpts to prove nothing is written.
  const written = [];
  const sink = { write(s) { written.push(s); return true; } };
  const agents = [{ id: 'dev-1', status: 'running', lastActivityMs: NOW - stalledMs }]; // stalled
  const r = await scanForStalled({ agents, now: NOW, notifyOpts: { env: {}, sink } });
  // classification still happens; notification is OFF → no terminal write, but it IS counted as a
  // "notified" attempt (we attempted to notify exactly once, deduped). Side effect is suppressed.
  ok('off-by-default: still classifies stalled', r.stalled.includes('dev-1'));
  ok('off-by-default: NO terminal side effect (sink untouched)', written.length === 0);
}

// --- dedupe across repeated scans (long-lived scanner) ----------------------------------------
{
  const notify = makeNotify();
  const stalledAgent = [{ id: 'stuck', status: 'running', lastActivityMs: NOW - stalledMs }];
  const scanner = createStalledScanner({
    fetchAgents: async () => stalledAgent,
    notify, notifyOpts: { channels: ['terminal-bell'] },
  });
  await scanner.scan({ now: NOW });
  await scanner.scan({ now: NOW + 60_000 }); // still stalled on the 2nd tick
  await scanner.scan({ now: NOW + 120_000 });
  ok('dedupe: same stalled agent notified ONCE across 3 scans', notify.calls.length === 1);
  ok('dedupe: scanner tracks notified id', scanner.notifiedIds().join() === 'stuck');
  scanner.reset();
  await scanner.scan({ now: NOW + 180_000 });
  ok('dedupe: reset() re-arms notification', notify.calls.length === 2);
}

// --- default fetcher: bad fetch / non-ok response → empty roster, never throws ----------------
{
  const scanner = createStalledScanner({
    projectId: 'p1',
    fetch: async () => { throw new Error('network down'); },
    notify: makeNotify(),
  });
  const r = await scanner.scan({ now: NOW });
  ok('default fetcher: fetch throw → empty scan, no throw', r.scanned === 0 && r.notified.length === 0);
}
{
  const scanner = createStalledScanner({
    projectId: 'p1',
    fetch: async () => ({ ok: true, json: async () => ([{ id: 'z', status: 'running', lastActivityMs: NOW - stalledMs }]) }),
    notify: (() => { const n = makeNotify(); return n; })(),
    notifyOpts: { channels: ['terminal-bell'] },
  });
  const r = await scanner.scan({ now: NOW });
  ok('default fetcher: parses agent array from API → classifies stalled', r.stalled.includes('z'));
}

// --- now is required (deterministic) ----------------------------------------------------------
{
  let threw = false;
  try { await scanForStalled({ agents: [], now: undefined }); } catch { threw = true; }
  ok('scanForStalled requires finite now (throws otherwise)', threw === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
