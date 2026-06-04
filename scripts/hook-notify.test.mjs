// Smoke test for the CJS-hook → notify-event wiring (FRW-BL-063 ISC-3 build_gate_fail emit site).
// Verifies the extracted `fireNotify` in teammate-idle.js / task-completed.js calls notifyEvent on
// the failure path, crosses the CJS→ESM boundary via the injected importer, and NEVER throws/blocks.
// Run: node scripts/hook-notify.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('hook → notify-event wiring smoke test\n');

const teammateIdle = require('../.claude/hooks/teammate-idle.js');
const taskCompleted = require('../.claude/hooks/task-completed.js');

ok('teammate-idle.js exports fireNotify', typeof teammateIdle.fireNotify === 'function');
ok('task-completed.js exports fireNotify', typeof taskCompleted.fireNotify === 'function');

// Helper: build an injected importer that resolves to a recording notifyEvent and lets us await it.
function makeImportSpy() {
  const calls = [];
  let resolveCalled;
  const calledOnce = new Promise((res) => { resolveCalled = res; });
  const fakeModule = {
    notifyEvent: async (eventType, payload, opts) => {
      calls.push({ eventType, payload, opts });
      resolveCalled();
      return { fired: false, skipped: true }; // off-by-default shape
    },
  };
  // _import receives the module URL; returns the fake module (mirrors dynamic import()).
  const _import = async () => fakeModule;
  return { _import, calls, calledOnce };
}

// --- teammate-idle.fireNotify('build_gate_fail', …) calls notifyEvent on the failure path -------
{
  const { _import, calls, calledOnce } = makeImportSpy();
  // fireNotify returns synchronously (fire-and-forget); the import + notifyEvent run async.
  const ret = teammateIdle.fireNotify('build_gate_fail', { teammate: 'dev-1', message: 'tsc failed' }, { _import });
  ok('fireNotify returns void/undefined immediately (non-blocking)', ret === undefined);
  await calledOnce; // wait for the fire-and-forget chain to land
  ok('build_gate_fail: notifyEvent invoked via injected importer', calls.length === 1 && calls[0].eventType === 'build_gate_fail');
  ok('build_gate_fail: payload forwarded (teammate/message)', calls[0].payload.teammate === 'dev-1' && /tsc failed/.test(calls[0].payload.message));
}

// --- task-completed.fireNotify also wires build_gate_fail --------------------------------------
{
  const { _import, calls, calledOnce } = makeImportSpy();
  taskCompleted.fireNotify('build_gate_fail', { cardId: 'C9', message: 'no build_gate_passed' }, { _import });
  await calledOnce;
  ok('task-completed build_gate_fail: notifyEvent invoked with cardId', calls.length === 1 && calls[0].payload.cardId === 'C9');
}

// --- NEVER THROWS even if the importer rejects or the module lacks notifyEvent -----------------
{
  let threw = false;
  try {
    teammateIdle.fireNotify('build_gate_fail', {}, { _import: async () => { throw new Error('import failed'); } });
    teammateIdle.fireNotify('build_gate_fail', {}, { _import: async () => ({}) }); // no notifyEvent
  } catch { threw = true; }
  // give the swallowed rejections a tick to settle
  await new Promise((r) => setTimeout(r, 10));
  ok('fireNotify never throws on import reject / missing export', threw === false);
}

// --- notifyOpts is forwarded to notifyEvent ----------------------------------------------------
{
  const { _import, calls, calledOnce } = makeImportSpy();
  teammateIdle.fireNotify('build_gate_fail', { x: 1 }, { _import, notifyOpts: { channels: ['terminal-bell'] } });
  await calledOnce;
  ok('fireNotify forwards notifyOpts to notifyEvent', calls[0].opts && Array.isArray(calls[0].opts.channels) && calls[0].opts.channels[0] === 'terminal-bell');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
