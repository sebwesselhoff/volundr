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

const { resolveParentDashboardId, inferAgentType, resolveRegistration, chooseDescriptor, GENERIC_SUBAGENT_TYPES } = require('./agent-start.js');

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

// --- FRW-BL-114: unclassifiable events must NOT become `developer` -------------------------
//
// A session on project snow-addendum that spawned ZERO subagents registered 150 rows of type
// `developer`. Every one had the same signature: startedAt == completedAt to the millisecond, zero
// tokens, null cardId, null sessionId, and a bare 'a'-prefixed hex id as its detail — which is
// `input.agent_id`, the value agent-start falls back to when `input.agent_type` is EMPTY.
//
// The cause is that inferAgentType had TWO unconditional `return 'developer'` fallbacks, making
// `developer` the type of everything it could not classify. That is not a cosmetic mislabel:
// `extractSkills` weights persona skill confidence on `developer` rows, so unclassifiable events
// silently diluted the signal FRW-002 depends on.
console.log('\nFRW-BL-114: unclassifiable agents must not be typed `developer`\n');

// COUNTER-PROOF FIRST — the exact phantom inputs observed in the real incident. Under the pre-fix
// code every one of these returned 'developer'. If they did NOT return 'unknown' now, everything
// below would be restating the fix rather than detecting its regression.
assertEq('PHANTOM: an EMPTY agent_type is unknown, not developer', inferAgentType(''), 'unknown');
assertEq('PHANTOM: a null agent_type is unknown, not developer', inferAgentType(null), 'unknown');
assertEq('PHANTOM: undefined is unknown, not developer', inferAgentType(undefined), 'unknown');
assertEq('PHANTOM: a bare agent_id (the observed detail) is unknown',
  inferAgentType('a7322189b24dcbc4b'), 'unknown');
assertEq('PHANTOM: the second observed id is unknown', inferAgentType('a883148af9db2e378'), 'unknown');
assertEq('PHANTOM: a workflow subagent is unknown, not developer',
  inferAgentType('workflow-subagent'), 'unknown');

// The generic Agent-tool types carry no ROLE information, so they must not be guessed at either.
// This is the half found live in this repo rather than on snow-addendum: a blind reviewer named
// `reviewer-frw-bl-111` was registered as a `developer` because its subagent_type is
// `general-purpose`, and the type was taken from that instead of from the name.
assertEq('GENERIC: general-purpose is unknown, not developer', inferAgentType('general-purpose'), 'unknown');
assertEq('GENERIC: Explore is unknown', inferAgentType('Explore'), 'unknown');
assertEq('GENERIC: Plan is unknown', inferAgentType('Plan'), 'unknown');
assertEq('GENERIC: the list is exported so callers cannot drift from it',
  GENERIC_SUBAGENT_TYPES.includes('general-purpose'), true);

// REAL roles must still classify — the fix must not blunt the classifier it is fixing.
assertEq('REAL: a blind reviewer is a review, not a developer',
  inferAgentType('reviewer-frw-bl-111'), 'review');
assertEq('REAL: a researcher still classifies', inferAgentType('researcher-dash-selector'), 'researcher');
assertEq('REAL: a domain developer still classifies', inferAgentType('domain-dev-backend'), 'developer');
assertEq('REAL: an architect still classifies', inferAgentType('the-architect'), 'architect');
assertEq('REAL: a qa engineer still classifies', inferAgentType('qa-eng-1'), 'qa-engineer');
assertEq('REAL: a tester still classifies', inferAgentType('tester-x'), 'tester');
assertEq('REAL: a guardian is a review', inferAgentType('guardian-1'), 'review');
assertEq('REAL: a fixer is a developer', inferAgentType('fixer-3'), 'developer');

// The fallback is a parameter, so a caller that genuinely knows better can say so — but the
// DEFAULT is the safe one. A default of 'developer' is what caused the incident.
assertEq('the fallback is overridable for a caller that knows better',
  inferAgentType('nonsense-name', 'tester'), 'tester');
assertEq('but the DEFAULT fallback is unknown', inferAgentType('nonsense-name'), 'unknown');

// Case-insensitivity: 'General-Purpose' must not slip past the generic check.
assertEq('generic matching is case-insensitive', inferAgentType('General-Purpose'), 'unknown');

// --- FRW-BL-114 ISC-2: the DECISION TO WRITE A ROW, not just the classifier ------------------
//
// Relabelling a phantom `unknown` instead of `developer` stops it polluting persona skill
// confidence, but it does not stop the row existing. The card asks that a session spawning nothing
// register exactly ONE row (the lead), which requires DECLINING TO WRITE.
//
// This is the wiring, not the handler — the distinction this project retracted FRW-BL-091 ISC-3
// over. resolveRegistration is the branch that main() actually consults before its apiPost.
console.log('\nFRW-BL-114 ISC-2: registration is declined when nothing identifies an agent\n');

// THE PHANTOM: no agent_type, no descriptor, no parent. This is the exact shape behind the 150
// rows on snow-addendum — the only thing those firings carried was a generated agent_id.
assertEq('PHANTOM: no type + no descriptor + no parent → NOT registered',
  resolveRegistration({ agentType: '', preToolData: null, parentAgentId: null }).register, false);
assertEq('PHANTOM: the suppression carries a reason so it can be logged and counted',
  /nothing identifies an agent/.test(
    resolveRegistration({ agentType: '', preToolData: null, parentAgentId: null }).reason || ''), true);
assertEq('PHANTOM: whitespace-only agent_type is still no identity',
  resolveRegistration({ agentType: '   ', preToolData: null, parentAgentId: null }).register, false);
assertEq('PHANTOM: undefined everything → NOT registered', resolveRegistration({}).register, false);
assertEq('PHANTOM: called with no argument at all does not throw', resolveRegistration().register, false);

// ANY ONE of the three identity signals is enough. These are the false-negative cases: suppressing
// a REAL spawn would lose tracking, which is strictly worse than a mislabelled row.
assertEq('REAL: an agent_type alone is enough to register',
  resolveRegistration({ agentType: 'reviewer-x', preToolData: null, parentAgentId: null }).register, true);
assertEq('REAL: a queued descriptor NAME alone is enough',
  resolveRegistration({ agentType: '', preToolData: { name: 'probe-alpha' }, parentAgentId: null }).register, true);
assertEq('REAL: a descriptor DESCRIPTION alone is enough',
  resolveRegistration({ agentType: '', preToolData: { description: 'Blind review' }, parentAgentId: null }).register, true);
assertEq('REAL: a descriptor CARD alone is enough',
  resolveRegistration({ agentType: '', preToolData: { cardId: 'FRW-BL-114' }, parentAgentId: null }).register, true);
assertEq('REAL: a resolvable PARENT alone is enough — a spawn belongs to something',
  resolveRegistration({ agentType: '', preToolData: null, parentAgentId: 'dash-parent' }).register, true);
assertEq('REAL: a registered spawn carries no suppression reason',
  resolveRegistration({ agentType: 'x' }).reason, null);

// An agent_id is NOT identity. It is generated per firing and was the entire content of every
// phantom row's detail field — treating it as identity would re-admit exactly what this excludes.
assertEq('an empty descriptor OBJECT is not identity',
  resolveRegistration({ agentType: '', preToolData: {}, parentAgentId: null }).register, false);
assertEq('a descriptor carrying only a model is not identity',
  resolveRegistration({ agentType: '', preToolData: { model: 'sonnet' }, parentAgentId: null }).register, false);

// The real agents from this session must all survive the check — a fix that suppressed genuine
// work would be a far worse defect than the one it replaces.
assertEq('LIVE: this session\'s blind reviewer would still register',
  resolveRegistration({ agentType: 'reviewer-frw-bl-114', preToolData: { name: 'reviewer-frw-bl-114' }, parentAgentId: 'p' }).register, true);
assertEq('LIVE: a Workflow subagent still registers (it is a real agent, just generically typed)',
  resolveRegistration({ agentType: 'workflow-subagent', preToolData: null, parentAgentId: 'p' }).register, true);

// --- FRW-BL-094: the descriptor handoff is KEYED, never positional ---------------------------
//
// pre-agent-tool.js queues a descriptor per Agent-tool call carrying the card and persona; this
// hook consumes one when a subagent starts. The old path popped the OLDEST entry matching a type,
// correlated with nothing — so a spawn starting while another spawn's descriptor was pending could
// claim someone else's cardId and personaId.
//
// FALSE attribution is worse than none: a missing cardId is visibly empty, a wrong one is silently
// plausible and hands a card quality signal and skill confidence from work never done for it.
console.log('\nFRW-BL-094: descriptor handoff must be keyed, and fail closed when it cannot be\n');

const desc = (name, subagentType, cardId) => ({ file: `/q/${name}`, data: { name, subagentType, cardId } });

// THE CROSSING SCENARIO — the defect itself, with the PRE-FIX algorithm reconstructed here so the
// fixture is proven to trigger it. Asserting only the new behaviour would be circular: it would
// pass just as happily against a fixture that never crossed in the first place.
//
// This mirrors the deleted popDescriptionFromQueue: filter the queue by the agent's type, take the
// OLDEST match, consume it. `owner` is test metadata recording which spawn each descriptor actually
// belongs to — chooseDescriptor never sees it.
const positionalPop = (candidates, typeKey) =>
  candidates.filter((c) => c.data.subagentType === typeKey)[0]?.data ?? null;

(() => {
  // Spawn A enqueued first and has not started yet. Spawn B starts. Both are unnamed
  // general-purpose subagents, which is the ordinary shape of a burst Agent-tool spawn.
  const queue = [
    { file: '/q/a', data: { name: '', subagentType: 'general-purpose', cardId: 'FRW-BL-001', owner: 'spawn-A' } },
    { file: '/q/b', data: { name: '', subagentType: 'general-purpose', cardId: 'FRW-BL-002', owner: 'spawn-B' } },
  ];

  // RED: the pre-fix algorithm hands spawn B the descriptor belonging to spawn A. This assertion
  // FAILS if the fixture does not actually reproduce the defect, which is what makes it a counter-proof.
  const stolen = positionalPop(queue, 'general-purpose');
  assertEq('PRE-FIX: positional pop hands the starting agent ANOTHER spawn\'s descriptor', stolen.owner, 'spawn-A');
  assertEq('PRE-FIX: and therefore another card\'s id — false attribution, not missing', stolen.cardId, 'FRW-BL-001');

  // GREEN: the keyed chooser refuses. Nothing distinguishes the two, so it takes neither.
  const r = chooseDescriptor(queue, { name: '', agentType: 'general-purpose' });
  assertEq('FIXED: the same queue and the same starting agent → picks NOTHING (fails closed)', r.pick, null);
  assertEq('FIXED: and says WHY, so the unattributed row is explainable', r.reason, 'ambiguous-type');
  assertEq('FIXED: specifically does not return the entry the pre-fix pop returned',
    r.pick === null || r.pick.owner !== 'spawn-A', true);
})();

// THE MEASURED CASE — two NAMED spawns in one message. A live probe (probe-alpha/probe-beta with
// different card headers) showed attribution did NOT cross, so this path already held; it is
// asserted here so a refactor cannot silently break what the probe confirmed works.
(() => {
  const queue = [desc('probe-alpha', 'general-purpose', 'FRW-BL-094'), desc('probe-beta', 'general-purpose', 'FRW-BL-095')];
  const a = chooseDescriptor(queue, { name: 'probe-alpha', agentType: 'probe-alpha' });
  const b = chooseDescriptor(queue, { name: 'probe-beta', agentType: 'probe-beta' });
  assertEq('NAMED: alpha gets its own card', a.pick.cardId, 'FRW-BL-094');
  assertEq('NAMED: beta gets its own card', b.pick.cardId, 'FRW-BL-095');
  assertEq('NAMED: the match is by name, not position', a.reason, 'name-match');
  assertEq('NAMED: order in the queue does not decide it',
    chooseDescriptor([...queue].reverse(), { name: 'probe-alpha' }).pick.cardId, 'FRW-BL-094');
})();

// A UNIQUE type match is safe — there is nothing to confuse it with.
(() => {
  const queue = [{ file: '/q/a', data: { name: '', subagentType: 'general-purpose', cardId: 'FRW-BL-050' } }];
  const r = chooseDescriptor(queue, { name: '', agentType: 'general-purpose' });
  assertEq('SOLO: a single matching descriptor IS used', r.pick.cardId, 'FRW-BL-050');
  assertEq('SOLO: reported as a unique-type match, not a name match', r.reason, 'unique-type-match');
})();

// Ways this could be quietly wrong.
assertEq('an empty queue picks nothing', chooseDescriptor([], { name: 'x' }).pick, null);
assertEq('an empty queue says so', chooseDescriptor([], { name: 'x' }).reason, 'queue-empty');
assertEq('null input does not throw', chooseDescriptor(null, { name: 'x' }).pick, null);
assertEq('a descriptor for a DIFFERENT name is not taken',
  chooseDescriptor([desc('other-agent', 'general-purpose', 'FRW-BL-001')], { name: 'my-agent' }).pick, null);
assertEq('a descriptor for a different TYPE is not taken',
  chooseDescriptor([desc('', 'explore', 'FRW-BL-001')], { name: '', agentType: 'general-purpose' }).pick, null);
assertEq('two descriptors sharing a NAME are also ambiguous, not first-wins',
  chooseDescriptor([desc('dup', 'gp', 'FRW-BL-001'), desc('dup', 'gp', 'FRW-BL-002')], { name: 'dup' }).reason,
  'ambiguous-name');
assertEq('malformed entries are skipped rather than throwing',
  chooseDescriptor([null, { file: '/q/x' }, desc('ok', 'gp', 'FRW-BL-003')], { name: 'ok' }).pick.cardId, 'FRW-BL-003');
assertEq('a name match wins over a same-type competitor',
  chooseDescriptor([desc('', 'gp', 'FRW-BL-001'), desc('mine', 'gp', 'FRW-BL-002')], { name: 'mine', agentType: 'gp' }).pick.cardId,
  'FRW-BL-002');

// ISC-5: Workflow-spawned subagents. pre-agent-tool.js never fires for them (PreToolUse matches
// `Agent`, not `Workflow`), so no descriptor is ever queued for a workflow agent. The behaviour is
// therefore EXPLICIT EXCLUSION, asserted rather than assumed: they must never inherit a descriptor
// queued by an unrelated genuine Agent-tool call.
(() => {
  const queue = [desc('real-dev', 'general-purpose', 'FRW-BL-007')];
  const r = chooseDescriptor(queue, { name: 'workflow-subagent', agentType: 'workflow-subagent' });
  assertEq('WORKFLOW: a workflow subagent does NOT inherit a pending Agent-tool descriptor', r.pick, null);
  assertEq('WORKFLOW: it is excluded by not matching, not by a special case', r.reason, 'no-match');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
