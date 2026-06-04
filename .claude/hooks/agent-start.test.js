// Self-test for agent-start.js resolveParentDashboardId (FRW-BL-029 + FRW-BL-068).
// Verifies parent attribution and, critically, that TWO CONCURRENT Volundr sessions are
// disambiguated by session_id rather than collapsing to agents[0] (the old mis-parenting
// fallback).
//
// FRW-BL-068 made this a CODE INVARIANT: the mother's session_id is persisted ON its agent
// row (agents.session_id), and the spawning subagent resolves its parent by matching that
// row's sessionId to input.session_id — needing NO tmpdir file and NO boot step. The legacy
// session-<id> tmpdir map (read via readMap) is demoted to a FALLBACK for legacy NULL rows.
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

// A: forward-compat parent_agent_id present and mapped → source 'parent_agent_id' (wins over everything)
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: 'cli-parent-123',
    sessionId: 'SX',
    readMap: mapOf({ 'cli-parent-123': 'dash-parent', 'session-SX': 'dash-session' }),
    runningVolundr: [{ id: 'A', sessionId: 'SX' }, { id: 'B' }],
  });
  assertEq('A. parent_agent_id wins when present+mapped (source)', r.source, 'parent_agent_id');
  assertEq('A. parent_agent_id wins when present+mapped (id)', r.id, 'dash-parent');
})();

// B (FRW-BL-068): ROW MATCH is the primary path. A running volundr row with sessionId === input
//    session_id is chosen, and source is 'session-row' (NOT the file-based 'session-file').
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({ 'session-SX': 'dash-file' }), // file map ALSO present...
    runningVolundr: [{ id: 'dash-row', sessionId: 'SX' }],
  });
  assertEq('B. resolves via agents.session_id ROW match (source)', r.source, 'session-row');
  assertEq('B. row match wins over the tmpdir file map (id)', r.id, 'dash-row');
})();

// C (FRW-BL-068 ISC-4 PROOF): CONCURRENT SESSIONS, NO file map at all — pure row resolution.
//    Two running volundr rows; input.session_id SB must pick the row whose sessionId === 'SB'
//    (dashB), NOT agents[0] (dashA). This proves correct attribution with NO boot-step file.
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SB',
    readMap: mapOf({}), // <-- no session-<id> file written; pure invariant
    runningVolundr: [{ id: 'dashA', sessionId: 'SA' }, { id: 'dashB', sessionId: 'SB' }],
  });
  assertEq('C. concurrent sessions w/ NO file: picks right volundr by row session (id)', r.id, 'dashB');
  assertEq('C. concurrent sessions: source is session-row (invariant, not ambiguous)', r.source, 'session-row');
})();

// D (FRW-BL-068): file map is a FALLBACK only — used when NO row matches (legacy NULL session_id).
//    Rows have NULL session_id (pre-migration-018); resolution falls through to the file map.
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({ 'session-SX': 'dash-file' }),
    runningVolundr: [{ id: 'legacyA', sessionId: null }, { id: 'legacyB', sessionId: null }],
  });
  assertEq('D. no row match → falls back to tmpdir file map (source)', r.source, 'session-file');
  assertEq('D. no row match → tmpdir file map id used (id)', r.id, 'dash-file');
})();

// E (FRW-BL-068): row session_id present but DIFFERENT from input — must NOT row-match, and with
//    no file map + multiple volundr → ambiguous (never silently steal a non-matching row).
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SZ', // matches no row
    readMap: mapOf({}),
    runningVolundr: [{ id: 'dashA', sessionId: 'SA' }, { id: 'dashB', sessionId: 'SB' }],
  });
  assertEq('E. non-matching session w/ multiple volundr → ambiguous (source)', r.source, 'ambiguous');
  assertEq('E. non-matching session → best-effort [0] (id)', r.id, 'dashA');
})();

// F: single running volundr (NULL session_id), no row match, no file map → 'single-volundr'
//    AND learns the session-<id> file map for next time (unchanged FRW-BL-029 fallback).
(() => {
  const writes = {};
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({}),
    writeMap: (k, v) => { writes[k] = v; },
    runningVolundr: [{ id: 'solo', sessionId: null }],
  });
  assertEq('F. single volundr → source single-volundr', r.source, 'single-volundr');
  assertEq('F. single volundr → id', r.id, 'solo');
  assertEq('F. single volundr → learns session map', writes['session-SX'], 'solo');
})();

// G: nothing resolvable → none / null
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: undefined,
    readMap: mapOf({}),
    runningVolundr: [],
  });
  assertEq('G. nothing resolvable → source none', r.source, 'none');
  assertEq('G. nothing resolvable → id null', r.id, null);
})();

// H: parent_agent_id present but UNMAPPED → falls through to the row match (FRW-BL-068).
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: 'cli-unmapped',
    sessionId: 'SX',
    readMap: mapOf({ 'session-SX': 'dash-file' }),
    runningVolundr: [{ id: 'dash-row', sessionId: 'SX' }, { id: 'B' }],
  });
  assertEq('H. unmapped parent_agent_id falls through to row match (source)', r.source, 'session-row');
  assertEq('H. unmapped parent_agent_id falls through to row match (id)', r.id, 'dash-row');
})();

// I (FRW-BL-068): row match takes PRECEDENCE over single-volundr — even with one volundr whose
//    row session matches, source must be 'session-row' (the invariant), not 'single-volundr'.
(() => {
  const r = resolveParentDashboardId({
    parentAgentId: undefined,
    sessionId: 'SX',
    readMap: mapOf({}),
    runningVolundr: [{ id: 'solo', sessionId: 'SX' }],
  });
  assertEq('I. single volundr WITH matching row → source session-row', r.source, 'session-row');
  assertEq('I. single volundr WITH matching row → id', r.id, 'solo');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
