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
const { isConfirmedSessionEnd } = require('./session-end.js');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
