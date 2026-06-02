// Self-test for agent-start.js resolveParentDashboardId (FRW-BL-029).
// Verifies parent attribution resolves via the session-keyed map and, critically,
// that TWO CONCURRENT Volundr sessions are disambiguated by session_id rather than
// collapsing to agents[0] (the old mis-parenting fallback).
//
// Run: node agent-start.test.js   — exits 0 on success, 1 on failure.
// Safe to require agent-start.js: its main() is guarded by require.main === module.

const { resolveParentDashboardId } = require('./agent-start.js');

let pass = 0;
let fail = 0;
function assertEq(label, actual, expected) {
  if (actual === expected) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      expected: ${expected}\n      actual:   ${actual}`); }
}

// Build a readMap from a plain object of key->id
const mapOf = (obj) => (key) => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);

console.log('agent-start resolveParentDashboardId self-test\n');

// A: forward-compat parent_agent_id present and mapped → source 'parent_agent_id'
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: 'cli-parent-123',
    sessionId: 'SX',
    readMap: mapOf({ 'cli-parent-123': 'dash-parent', 'session-SX': 'dash-session' }),
    runningVolundr: [{ id: 'A' }, { id: 'B' }],
  });
  assertEq('A. parent_agent_id wins when present+mapped (source)', r.source, 'parent_agent_id');
  assertEq('A. parent_agent_id wins when present+mapped (id)', r.id, 'dash-parent');
})();

// B: no parent_agent_id; session map present → source 'session'
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({ 'session-SX': 'dash-session' }),
    runningVolundr: [{ id: 'A' }],
  });
  assertEq('B. resolves via session map (source)', r.source, 'session');
  assertEq('B. resolves via session map (id)', r.id, 'dash-session');
})();

// C: CONCURRENT SESSIONS — two running volundr; session_id SB maps to dashB.
//    Must return dashB, NOT agents[0] (dashA). This is the ISC-2 regression guard.
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SB',
    readMap: mapOf({ 'session-SA': 'dashA', 'session-SB': 'dashB' }),
    runningVolundr: [{ id: 'dashA' }, { id: 'dashB' }],
  });
  assertEq('C. concurrent sessions: picks the right volundr by session (id)', r.id, 'dashB');
  assertEq('C. concurrent sessions: source is session (not ambiguous)', r.source, 'session');
})();

// D: single running volundr, no session map → 'single-volundr' AND learns the map
(() => {
  const writes = {};
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({}),
    writeMap: (k, v) => { writes[k] = v; },
    runningVolundr: [{ id: 'solo' }],
  });
  assertEq('D. single volundr → source single-volundr', r.source, 'single-volundr');
  assertEq('D. single volundr → id', r.id, 'solo');
  assertEq('D. single volundr → learns session map', writes['session-SX'], 'solo');
})();

// E: multiple running volundr, no session map → 'ambiguous', best-effort [0]
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({}),
    runningVolundr: [{ id: 'first' }, { id: 'second' }],
  });
  assertEq('E. multiple volundr + no session map → ambiguous (source)', r.source, 'ambiguous');
  assertEq('E. multiple volundr + no session map → best-effort [0] (id)', r.id, 'first');
})();

// F: nothing resolvable → none / null
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: undefined,
    readMap: mapOf({}),
    runningVolundr: [],
  });
  assertEq('F. nothing resolvable → source none', r.source, 'none');
  assertEq('F. nothing resolvable → id null', r.id, null);
})();

// G: parent_agent_id present but UNMAPPED → falls through to session map
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: 'cli-unmapped',
    sessionId: 'SX',
    readMap: mapOf({ 'session-SX': 'dash-session' }),
    runningVolundr: [{ id: 'A' }, { id: 'B' }],
  });
  assertEq('G. unmapped parent_agent_id falls through to session', r.source, 'session');
  assertEq('G. unmapped parent_agent_id falls through to session (id)', r.id, 'dash-session');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
