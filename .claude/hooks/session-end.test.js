// session-end.test.js — Self-test for the SessionEnd/StopFailure discriminator (FRW-BL-113)
// Run: node .claude/hooks/session-end.test.js
// No test framework dependency — uses Node.js built-in `assert`.
//
// Why this exists: .claude/settings.json registers session-end.js under BOTH SessionEnd and
// StopFailure with identical args — no config-level signal distinguishes them. A live incident
// (session a6cce6c6, 2026-08-12) had a StopFailure-triggered run execute the FULL teardown
// (complete all running agents, clear activeProject) while the session was demonstrably still
// alive: the lead agent's own row carried a heartbeat timestamped AFTER its recorded completedAt,
// and a reviewer subagent marked completed delivered its verdict three minutes later.
//
// Fix: gate the teardown on `hook_event_name === 'SessionEnd'`, confirmed present on every hook
// invocation per the Claude Code hooks reference (code.claude.com/docs/en/hooks.md, checked
// 2026-08-12) as part of the COMMON input fields, carrying the literal firing event's name.

const assert = require('assert');
const { isConfirmedSessionEnd, selectSweepTargets } = require('./session-end.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// The counter-proof, first: the exact live incident this fix responds to.
// If this does not fail as false, everything below just restates the fix.
// ---------------------------------------------------------------------------
test('COUNTER-PROOF: a StopFailure invocation is NOT a confirmed SessionEnd', () => {
  assert.strictEqual(isConfirmedSessionEnd('StopFailure'), false);
});

test('a genuine SessionEnd invocation IS confirmed', () => {
  assert.strictEqual(isConfirmedSessionEnd('SessionEnd'), true);
});

test('a missing hook_event_name (undefined) fails SAFE — not confirmed', () => {
  assert.strictEqual(isConfirmedSessionEnd(undefined), false);
});

test('a null hook_event_name fails SAFE — not confirmed', () => {
  assert.strictEqual(isConfirmedSessionEnd(null), false);
});

test('an empty string fails SAFE — not confirmed', () => {
  assert.strictEqual(isConfirmedSessionEnd(''), false);
});

test('other real hook events (Stop, SubagentStop, PreToolUse) are NOT confirmed SessionEnd', () => {
  assert.strictEqual(isConfirmedSessionEnd('Stop'), false);
  assert.strictEqual(isConfirmedSessionEnd('SubagentStop'), false);
  assert.strictEqual(isConfirmedSessionEnd('PreToolUse'), false);
});

test('is exact-match, not prefix/substring — "SessionEndSomething" is not confirmed', () => {
  assert.strictEqual(isConfirmedSessionEnd('SessionEndSomething'), false);
  assert.strictEqual(isConfirmedSessionEnd('NotSessionEnd'), false);
});

test('is case-sensitive — the platform sends exact casing, a near-miss must not silently pass', () => {
  assert.strictEqual(isConfirmedSessionEnd('sessionend'), false);
  assert.strictEqual(isConfirmedSessionEnd('SESSIONEND'), false);
});

test('a non-string value (e.g. accidental object/number) fails SAFE, does not throw', () => {
  assert.strictEqual(isConfirmedSessionEnd(42), false);
  assert.strictEqual(isConfirmedSessionEnd({}), false);
  assert.strictEqual(isConfirmedSessionEnd(['SessionEnd']), false);
});

// ---------------------------------------------------------------------------
// INTEGRATION: drive the REAL hook process, so the gate's WIRING and ORDER are
// asserted — not just the pure function. Raised by the FRW-BL-113 blind reviewer:
// "a future refactor could re-break the gate order without any test catching it."
// Same pattern as enforce-worktree-path-write.test.js tests 9-12, which drive the real
// hook with tool-shaped stdin rather than calling its helper directly.
//
// Isolation: a throwaway VLDR_HOME (so the real registry.json can never be touched) plus
// an unreachable VLDR_API_URL (so no dashboard write can land). The assertion is on the
// side effect that matters and is observable without the API: whether activeProject in the
// throwaway registry survives.
// ---------------------------------------------------------------------------
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runHookWithHome(payload) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vldr-session-end-test-'));
  const projects = path.join(home, 'projects');
  fs.mkdirSync(projects, { recursive: true });
  const registryPath = path.join(projects, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, projects: {}, activeProject: 'canary-project' }, null, 2));

  let exitCode = 0;
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'session-end.js')], {
      input: JSON.stringify(payload),
      env: {
        ...process.env,
        VLDR_HOME: home,
        // Point at a closed port: any attempted dashboard write fails fast instead of
        // mutating real state. vldr-api swallows fetch failures by design.
        VLDR_API_URL: 'http://127.0.0.1:9',
        VLDR_PROJECT_ID: 'canary-project',
      },
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    exitCode = typeof e.status === 'number' ? e.status : -1;
  }

  const after = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  return { exitCode, activeProject: after.activeProject };
}

test('INTEGRATION: a StopFailure invocation leaves activeProject UNTOUCHED', () => {
  const r = runHookWithHome({ hook_event_name: 'StopFailure', session_id: 'test-session' });
  assert.strictEqual(
    r.activeProject, 'canary-project',
    `StopFailure must not clear activeProject, but it became ${JSON.stringify(r.activeProject)}`,
  );
});

test('INTEGRATION: a payload with NO hook_event_name leaves activeProject UNTOUCHED (fail-safe)', () => {
  const r = runHookWithHome({ session_id: 'test-session' });
  assert.strictEqual(r.activeProject, 'canary-project');
});

test('INTEGRATION COUNTER-PROOF: a genuine SessionEnd DOES clear activeProject', () => {
  // Without this, the two assertions above would also pass on a hook that never clears
  // anything at all — proving nothing about the gate, only about inaction.
  const r = runHookWithHome({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit', session_id: 'test-session' });
  assert.strictEqual(
    r.activeProject, null,
    `A real SessionEnd must still clear activeProject, but it stayed ${JSON.stringify(r.activeProject)}`,
  );
});

test('INTEGRATION: SessionEnd with reason=clear leaves activeProject UNTOUCHED (pre-existing rule)', () => {
  const r = runHookWithHome({ hook_event_name: 'SessionEnd', reason: 'clear', session_id: 'test-session' });
  assert.strictEqual(r.activeProject, 'canary-project');
});


// --- FRW-BL-095: the sessionId-scoped sweep ---------------------------------------------------
// This was the untested half of making session-end.js the SOLE emitter of a subagent's terminal
// agent_completed. The rule has already been got wrong once: a project-scoped sweep completed every
// OTHER live session's agents, and because a swept row can never be swept again (sweeps only look
// at status='running'), "exactly one agent_completed" silently became "exactly zero" for them.

const SWEEP_SESSION = 'sess-aaa';
const SWEEP_ROWS = [
  { id: 'mine-1', sessionId: SWEEP_SESSION },
  { id: 'mine-2', sessionId: SWEEP_SESSION },
  { id: 'other-1', sessionId: 'sess-bbb' },
  { id: 'legacy-1', sessionId: null },
  { id: 'legacy-2' },
];
const sweptIds = (list) => list.map((a) => a.id).sort().join(',');

test('sweeps this session\'s agents plus legacy NULL-sessionId rows', () => {
  assert.strictEqual(sweptIds(selectSweepTargets(SWEEP_ROWS, SWEEP_SESSION)),
    'legacy-1,legacy-2,mine-1,mine-2');
});

test('COUNTER-PROOF: another live session\'s agent is NOT swept (the exactly-one → exactly-zero bug)', () => {
  assert.ok(!selectSweepTargets(SWEEP_ROWS, SWEEP_SESSION).some((a) => a.id === 'other-1'));
});

test('the same rule holds from the other session\'s point of view', () => {
  assert.strictEqual(sweptIds(selectSweepTargets(SWEEP_ROWS, 'sess-bbb')),
    'legacy-1,legacy-2,other-1');
});

test('a payload with NO session_id sweeps everything — an unidentifiable SessionEnd must clean up, not leak', () => {
  assert.strictEqual(selectSweepTargets(SWEEP_ROWS, undefined).length, SWEEP_ROWS.length);
});

test('an empty-string session_id is treated as absent, not as a value that matches nothing', () => {
  assert.strictEqual(selectSweepTargets(SWEEP_ROWS, '').length, SWEEP_ROWS.length);
});

test('no running agents is not an error', () => {
  assert.strictEqual(selectSweepTargets([], SWEEP_SESSION).length, 0);
});

test('a null or undefined agent list does not throw', () => {
  assert.strictEqual(selectSweepTargets(null, SWEEP_SESSION).length, 0);
  assert.strictEqual(selectSweepTargets(undefined, SWEEP_SESSION).length, 0);
});

test('a null row inside the list is skipped rather than throwing', () => {
  assert.strictEqual(selectSweepTargets([null, { id: 'ok', sessionId: SWEEP_SESSION }], SWEEP_SESSION).length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
