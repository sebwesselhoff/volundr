#!/usr/bin/env node
// vldr-agent-resolve.test.js — FRW-BL-116.
//
// The load-bearing assertion here is ORDER: a subagent's PostToolUse carries the PARENT's
// session_id (established by a captured payload on 2026-08-27, three subagents all reporting the
// lead's session id). If session_id were checked first, every subagent's tool call would be
// attributed to the lead — the lead's liveness would appear fixed while every subagent stayed
// broken, which is a worse outcome than the original bug because it looks solved.
//
// Dependency-free, self-reporting via exit code, per project constraint.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickMapKey, resolveAgentId } = require('./vldr-agent-resolve');

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Real captured payload shapes (2026-08-27 probe).
const LEAD = {
  session_id: 'd0df4de6-ffd2-4984-b4fb-7bebd6827ac4',
  agent_id: null,
  agent_type: null,
  tool_name: 'Bash',
  hook_event_name: 'PostToolUse',
};
const SUBAGENT = {
  session_id: 'd0df4de6-ffd2-4984-b4fb-7bebd6827ac4', // NOTE: the PARENT's session id
  agent_id: 'areviewer-frw-bl-114-3214a8277df25f05',
  agent_type: 'reviewer-frw-bl-114',
  tool_name: 'Bash',
  hook_event_name: 'PostToolUse',
};

// --- pickMapKey: the ordering contract -------------------------------------------------------
eq('lead resolves to its session key',
  pickMapKey(LEAD), { kind: 'lead', key: 'session-d0df4de6-ffd2-4984-b4fb-7bebd6827ac4' });

eq('subagent resolves to its agent_id key, NOT the shared session key',
  pickMapKey(SUBAGENT), { kind: 'subagent', key: 'areviewer-frw-bl-114-3214a8277df25f05' });

check('subagent and lead share a session_id in the real payloads',
  LEAD.session_id === SUBAGENT.session_id,
  'if this ever stops being true the ordering rationale should be re-derived, not assumed');

check('the shared session_id does NOT leak into the subagent key',
  !pickMapKey(SUBAGENT).key.includes(SUBAGENT.session_id));

// --- pickMapKey: degenerate input ------------------------------------------------------------
eq('null input', pickMapKey(null), null);
eq('undefined input', pickMapKey(undefined), null);
eq('non-object input', pickMapKey('nope'), null);
eq('empty object', pickMapKey({}), null);
eq('empty-string agent_id falls through to session', pickMapKey({ agent_id: '', session_id: 's1' }),
  { kind: 'lead', key: 'session-s1' });
eq('whitespace-only agent_id falls through to session', pickMapKey({ agent_id: '   ', session_id: 's1' }),
  { kind: 'lead', key: 'session-s1' });
eq('non-string agent_id falls through to session', pickMapKey({ agent_id: 12345, session_id: 's1' }),
  { kind: 'lead', key: 'session-s1' });
eq('neither field present', pickMapKey({ tool_name: 'Bash' }), null);
eq('agent_id is trimmed', pickMapKey({ agent_id: '  aFoo-1  ' }), { kind: 'subagent', key: 'aFoo-1' });

// --- resolveAgentId: filesystem behaviour ----------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vldr-resolve-test-'));
try {
  fs.writeFileSync(path.join(tmp, 'areviewer-frw-bl-114-3214a8277df25f05'),
    '5030139b-cdbc-4467-ae3c-8b9d43c615fd\n');
  fs.writeFileSync(path.join(tmp, 'session-d0df4de6-ffd2-4984-b4fb-7bebd6827ac4'),
    '8286103e-4120-4c92-a2c4-13c0144e0c8a');

  eq('subagent resolves to ITS OWN dashboard row',
    resolveAgentId(SUBAGENT, { mapDir: tmp }), '5030139b-cdbc-4467-ae3c-8b9d43c615fd');

  eq('lead resolves to the lead row',
    resolveAgentId(LEAD, { mapDir: tmp }), '8286103e-4120-4c92-a2c4-13c0144e0c8a');

  check('subagent is NOT attributed to the lead row',
    resolveAgentId(SUBAGENT, { mapDir: tmp }) !== resolveAgentId(LEAD, { mapDir: tmp }),
    'this is the exact regression FRW-BL-116 ISC-1 exists to prevent');

  eq('trailing newline is trimmed',
    resolveAgentId(SUBAGENT, { mapDir: tmp }), '5030139b-cdbc-4467-ae3c-8b9d43c615fd');

  // Fails safe.
  eq('unknown agent_id returns null, does not throw',
    resolveAgentId({ agent_id: 'anever-registered-000' }, { mapDir: tmp }), null);
  eq('missing map dir returns null, does not throw',
    resolveAgentId(SUBAGENT, { mapDir: path.join(tmp, 'nope') }), null);
  eq('unresolvable payload returns null', resolveAgentId({}, { mapDir: tmp }), null);
  eq('null payload returns null', resolveAgentId(null, { mapDir: tmp }), null);

  // An empty map file must not resolve to an empty-string agentId.
  fs.writeFileSync(path.join(tmp, 'aempty-000'), '   \n');
  eq('empty map file returns null rather than an empty id',
    resolveAgentId({ agent_id: 'aempty-000' }, { mapDir: tmp }), null);

  // Path traversal in a key must not read outside the map dir.
  eq('traversal key is refused',
    resolveAgentId({ agent_id: '../../etc/passwd' }, { mapDir: tmp }), null);
  eq('separator in key is refused',
    resolveAgentId({ agent_id: 'sub/dir' }, { mapDir: tmp }), null);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
