// Self-test for agent-stop.js (FRW-BL-095).
//
// SubagentStop fires once per idle/wake CYCLE — the hook's own comments have said so for a long
// time, and it accumulated tokens for exactly that reason. It also wrote `status: 'completed'` on
// every one of those cycles. So a working agent read `completed` between turns: `?status=running`
// undercounted a live fan-out (one row shown during a six-agent wave), and stalled-scan could not
// tell idle-but-alive from finished.
//
// A payload probe settled whether a condition could fix it: there is NO finality signal in the
// SubagentStop payload. `stop_hook_active` is hook RE-ENTRANCY, not completion — reading it as
// completion would have been a plausible and wrong guess. Since finality is unknowable here,
// claiming it is the defect.
//
// Run: node .claude/hooks/agent-stop.test.js — exits 0 on success, 1 on failure.
// Safe to require agent-stop.js: its main() is guarded by require.main === module.

const { buildStopPatch, normalizeModel, decideLateRegistration } = require('./agent-stop.js');

let pass = 0;
let fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('agent-stop self-test (FRW-BL-095)\n');

const tok = (i, o, cc = 0, cr = 0) => ({ inputTokens: i, completionTokens: o, cacheCreationTokens: cc, cacheReadTokens: cr });

// --- the defect: terminal status on an idle yield -----------------------------
// THE load-bearing assertions. The pre-fix code set status:'completed' + completedAt on EVERY
// call, unconditionally. If either key can appear here, this card has not been implemented.
{
  const cases = [
    ['a cycle with tokens', { tokenData: tok(10, 5), existing: { promptTokens: 100 } }],
    ['a cycle with no tokens', { tokenData: tok(0, 0), existing: { promptTokens: 100 } }],
    ['a first cycle with no existing row', { tokenData: tok(10, 5) }],
    ['a cycle that only reconciles the model', { tokenData: tok(0, 0), normalizedModel: 'opus-4' }],
    ['no arguments at all', undefined],
  ];
  for (const [label, input] of cases) {
    const patch = buildStopPatch(input);
    ok(`NEVER writes status — ${label}`, !('status' in patch));
    ok(`NEVER writes completedAt — ${label}`, !('completedAt' in patch));
  }
}

// --- ISC-5: token accumulation must be PROVEN UNCHANGED -----------------------
// This is the part most at risk of being broken by accident, so it is checked against a
// reconstruction of the ORIGINAL accumulation rather than against my own expectations.
// (An earlier claim that this double-counted was WITHDRAWN after reading the code — each cycle
// reports only that turn's tokens and they are added to the row. That was already correct.)
{
  const originalAccumulation = (tokenData, existing) => ({
    promptTokens: ((existing && existing.promptTokens) || 0) + tokenData.inputTokens,
    completionTokens: ((existing && existing.completionTokens) || 0) + tokenData.completionTokens,
    cacheCreationTokens: ((existing && existing.cacheCreationTokens) || 0) + tokenData.cacheCreationTokens,
    cacheReadTokens: ((existing && existing.cacheReadTokens) || 0) + tokenData.cacheReadTokens,
  });

  const fixtures = [
    [tok(10, 5, 1, 2), { promptTokens: 100, completionTokens: 50, cacheCreationTokens: 3, cacheReadTokens: 4 }],
    [tok(1, 1), null],
    [tok(999, 888, 777, 666), { promptTokens: 1, completionTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 }],
  ];
  let allMatch = true;
  for (const [t, e] of fixtures) {
    const mine = buildStopPatch({ tokenData: t, existing: e });
    const theirs = originalAccumulation(t, e);
    for (const k of Object.keys(theirs)) if (mine[k] !== theirs[k]) allMatch = false;
  }
  ok('token accumulation is byte-identical to the pre-fix arithmetic (ISC-5)', allMatch);

  // Three cycles of the same agent: totals must march upward by each turn's marginal spend, which
  // is the property that makes the ROW correct even though the EVENTS were not.
  let row = { promptTokens: 0, completionTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  for (const t of [tok(100, 50), tok(200, 60), tok(30, 10)]) row = { ...row, ...buildStopPatch({ tokenData: t, existing: row }) };
  ok('three cycles accumulate to the sum of their turns, not a re-count', row.promptTokens === 330 && row.completionTokens === 120);
}

// --- an empty patch is a legitimate outcome -----------------------------------
// It was not before: the patch always carried a status, so it was never empty. Now an idle yield
// with nothing to report must produce {} so the caller can skip the round trip rather than send a
// no-op whose failure would trip the hook's fatal path.
{
  ok('an idle yield with no tokens and no model produces an EMPTY patch',
    Object.keys(buildStopPatch({ tokenData: tok(0, 0) })).length === 0);
  ok('no tokenData at all produces an EMPTY patch', Object.keys(buildStopPatch({})).length === 0);
  ok('cache-only activity still counts as tokens', 'promptTokens' in buildStopPatch({ tokenData: tok(0, 0, 5, 0) }));
  ok('a model with no tokens still produces a patch',
    buildStopPatch({ tokenData: tok(0, 0), normalizedModel: 'haiku-4' }).model === 'haiku-4');
  ok('a null model is omitted rather than written as null',
    !('model' in buildStopPatch({ tokenData: tok(1, 1), normalizedModel: null })));
}

// --- ways this could be quietly wrong ----------------------------------------
{
  ok('missing token fields are treated as zero, not NaN',
    buildStopPatch({ tokenData: { inputTokens: 5 }, existing: {} }).promptTokens === 5);
  ok('a partial existing row does not produce NaN',
    Number.isFinite(buildStopPatch({ tokenData: tok(1, 1), existing: { promptTokens: 10 } }).completionTokens));
  ok('null existing is handled', buildStopPatch({ tokenData: tok(1, 1), existing: null }).promptTokens === 1);
  ok('garbage does not throw', typeof buildStopPatch({ tokenData: null, existing: null }) === 'object');
}

// --- model normalisation is unchanged by this card ---------------------------
{
  ok('opus normalises', normalizeModel('claude-opus-4-8-20250101') === 'opus-4');
  ok('sonnet normalises', normalizeModel('claude-sonnet-5') === 'sonnet-4');
  ok('haiku normalises', normalizeModel('claude-haiku-4-5') === 'haiku-4');
  ok('an unknown model is null, not guessed', normalizeModel('gpt-9') === null);
  ok('empty is null', normalizeModel('') === null && normalizeModel(null) === null);
}

// --- ISC-8: the idle-then-RESUME lifecycle, against a reconstructed PRE-FIX handler ------------
//
// An earlier version of this file asserted only that the NEW function omits `status`. That is not a
// counter-proof — it would pass just as happily against a fixture that never exhibited the defect,
// and it never modelled a resume. The same mistake was made and corrected on FRW-BL-094; correcting
// it here rather than leaving the weaker version.
//
// `preFixStopPatch` reconstructs what agent-stop.js did before this card: accumulate tokens AND
// stamp terminal status on EVERY cycle. It is RUN against the same lifecycle, so the RED assertions
// fail if the scenario does not actually reproduce the defect.
console.log('\nFRW-BL-095 ISC-8: idle → resume → idle, against the reconstructed pre-fix handler\n');

const preFixStopPatch = ({ tokenData, existing, normalizedModel }) => {
  const patch = { status: 'completed', completedAt: '2026-08-27T10:00:00.000Z' };
  const total = tokenData ? (tokenData.inputTokens || 0) + (tokenData.completionTokens || 0) : 0;
  if (total > 0) {
    patch.promptTokens = ((existing && existing.promptTokens) || 0) + tokenData.inputTokens;
    patch.completionTokens = ((existing && existing.completionTokens) || 0) + tokenData.completionTokens;
  }
  if (normalizedModel) patch.model = normalizedModel;
  return patch;
};

// A real teammate lifecycle: works, yields (SubagentStop #1), RESUMES, works more, yields again.
// The middle step is the one that matters — the agent is alive after the first yield.
const lifecycle = [
  { phase: 'first yield  (still working)', tokens: tok(100, 50) },
  { phase: 'second yield (still working)', tokens: tok(200, 60) },
  { phase: 'final yield  (actually done)', tokens: tok(30, 10) },
];

{
  // RED — the pre-fix handler marks the agent terminal at the FIRST yield, while it is still alive.
  let row = { status: 'running', promptTokens: 0, completionTokens: 0 };
  const preFixStatuses = [];
  for (const step of lifecycle) {
    row = { ...row, ...preFixStopPatch({ tokenData: step.tokens, existing: row }) };
    preFixStatuses.push(row.status);
  }
  ok('PRE-FIX: the agent reads `completed` after its FIRST yield, while still working',
    preFixStatuses[0] === 'completed');
  ok('PRE-FIX: and stays terminal through every subsequent cycle — the defect, reproduced',
    preFixStatuses.every((s) => s === 'completed'));

  // GREEN — the same lifecycle through the shipped function never leaves `running`.
  let row2 = { status: 'running', promptTokens: 0, completionTokens: 0 };
  const statuses = [];
  for (const step of lifecycle) {
    row2 = { ...row2, ...buildStopPatch({ tokenData: step.tokens, existing: row2 }) };
    statuses.push(row2.status);
  }
  ok('FIXED: the agent reads `running` across the whole idle→resume→idle lifecycle',
    statuses.every((s) => s === 'running'));
  ok('FIXED: no completedAt is ever stamped mid-life', !('completedAt' in row2));

  // And the resume must not cost the tokens earned before it — the property that makes the ROW
  // trustworthy even while the EVENTS were not.
  ok('FIXED: tokens survive the resume and accumulate across all three cycles',
    row2.promptTokens === 330 && row2.completionTokens === 120);
  ok('FIXED: totals match what the pre-fix handler accumulated (only the status behaviour changed)',
    row2.promptTokens === 330);
}

// --- FRW-BL-114 SECOND SITE: the late-registration write guard -------------------------------
// A git audit on 2026-08-27 found this decision had ZERO coverage — no assertion anywhere
// referenced late_registration_suppressed, resolveRegistration or inferAgentType from this file —
// despite being the guard on the exact path that wrote a live phantom row during a session's own
// shutdown. The load-bearing line is resolvedName: agentDetailName falls back to input.agent_id
// upstream, and agent_id is generated per firing, so passing it through as a "name" would hand the
// guard a fake third signal and defeat it. That is precisely how the first fix (agent-start.js
// only) still left phantoms being written here.
console.log('\nlate-registration guard (FRW-BL-114 second site)\n');

const LATE = (o) => decideLateRegistration({
  agentType: undefined, agentId: 'a1b2c3d4e5f6', agentDetailName: 'a1b2c3d4e5f6',
  cardId: null, personaId: null, ...o,
});

// THE PHANTOM, reproduced: no type, no card, no persona, and a "name" that is only the agent_id.
ok('PHANTOM: no identity of any kind is declined',
  LATE().register === false);
ok('...and the refusal carries a reason', typeof LATE().reason === 'string' && LATE().reason.length > 0);
ok('...and agent_id is NOT promoted to a name',
  LATE().resolvedName === null);

// COUNTER-PROOFS: each single genuine signal is enough on its own. Without these the guard could
// pass the test above by refusing everything, which would lose real agents — a worse defect.
ok('REAL: an agent_type alone is enough to register',
  LATE({ agentType: 'reviewer-frw-bl-114' }).register === true);
ok('REAL: a cardId alone is enough to register',
  LATE({ cardId: 'FRW-BL-114' }).register === true);
// personaId alone is NOT enough, and this assertion documents that rather than wishing otherwise.
// I first wrote it as `=== true` and the code disagreed. The code is right about what it does:
// resolveRegistration counts `preToolData.name || .description || .cardId` and does NOT look at
// personaId at all (agent-start.js:44).
//
// THE INCONSISTENCY THAT EXPOSES, worth knowing rather than smoothing over: decideLateRegistration
// builds a descriptor when `(cardId || personaId || resolvedName)`, so a firing carrying ONLY a
// personaId constructs a descriptor object that then fails the check anyway — the `|| personaId`
// reads as if it matters and it does not. Not widened here: resolveRegistration's narrowness is
// deliberate and was reviewed, and a persona-only spawn is a narrow case. Flagged, not silently
// changed.
ok('personaId alone does NOT register — resolveRegistration ignores it (documents actual behaviour)',
  LATE({ personaId: 'researcher' }).register === false);
ok('...but a personaId ALONGSIDE a real signal still registers',
  LATE({ personaId: 'researcher', agentType: 'researcher' }).register === true);
ok('REAL: a name that differs from the agent_id is enough to register',
  LATE({ agentDetailName: 'reviewer-frw-bl-114' }).register === true);
ok('...and that name is passed through for classification',
  LATE({ agentDetailName: 'reviewer-frw-bl-114' }).resolvedName === 'reviewer-frw-bl-114');

// Degenerate inputs must not throw and must not accidentally look like identity.
ok('a missing agentDetailName does not become a name',
  LATE({ agentDetailName: undefined }).resolvedName === null);
ok('an empty agentDetailName does not become a name',
  LATE({ agentDetailName: '' }).resolvedName === null);
ok('a null agentId with a real name still registers',
  LATE({ agentId: null, agentDetailName: 'dev-frw-bl-120' }).register === true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
