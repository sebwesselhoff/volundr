// Self-test for enforce-worktree-path-write.js
// Sets up a temp fixture repo with a fake .claude/worktrees/agent-X subdir.
// FRW-BL-027 conditional enforcement: for an Agent Teams TEAMMATE context
// (CLAUDE_AGENT_TEAMS_MEMBER) the hook still BLOCKS out-of-worktree writes (exit 2,
// native coverage unverified for that path); for an Agent-tool SUBAGENT context
// (no TEAMS_MEMBER, native guard confirmed) it ADVISES only (exit 0). Writes inside
// the worktree are allowed, and the hook is a no-op when there are no worktrees.
//
// Run: node enforce-worktree-path-write.test.js
// Exits 0 on success, 1 on failure.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'enforce-worktree-path-write.js');

let pass = 0;
let fail = 0;

function assertEq(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}

function runHook(toolInput, env = {}) {
  const input = JSON.stringify({ tool_input: toolInput });
  // Always set CLAUDE_AGENT_TEAMS_MEMBER unless the caller overrode it,
  // so the hook's "only-fire-in-subagent-context" gate passes by default.
  const finalEnv = {
    ...process.env,
    CLAUDE_AGENT_TEAMS_MEMBER: '1',
    ...env,
  };
  return spawnSync('node', [HOOK], { input, env: finalEnv, encoding: 'utf8' });
}

function setupFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hook-test-'));
  // Fake parent repo
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  // Fake worktree directory
  const wt = path.join(repo, '.claude', 'worktrees', 'agent-test');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  return { tmp, repo, wt };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('enforce-worktree-path-write self-test\n');

// Test 1: TEAMMATE writes to parent repo while worktree exists → BLOCK (exit 2)
// (runHook sets CLAUDE_AGENT_TEAMS_MEMBER=1 by default → teammate context, native unverified)
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook({ file_path: path.join(repo, 'src', 'leak.cs') });
    assertEq('1. blocks teammate write outside worktree (exit 2; native unverified for teammates)', r.status, 2);
  } finally { cleanup(tmp); }
})();

// Test 2: Write INSIDE the worktree → ALLOW
(() => {
  const { tmp, wt } = setupFixture();
  try {
    const r = runHook({ file_path: path.join(wt, 'src', 'inside.cs') });
    assertEq('2. allows write inside the worktree', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 3: No worktree directory exists → ALLOW (defensive)
(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hook-test-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  try {
    const r = runHook({ file_path: path.join(repo, 'src', 'safe.cs') });
    assertEq('3. allows write when no worktrees active', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 4: Not in subagent context → ALLOW (the main Volundr session is exempt)
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook(
      { file_path: path.join(repo, 'src', 'main-session.cs') },
      { CLAUDE_AGENT_TEAMS_MEMBER: '', CLAUDE_AGENT_TYPE: '', CLAUDE_SUBAGENT_NAME: '', CLAUDE_AGENT_ID: '' },
    );
    assertEq('4. allows write when not a subagent', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 5: Relative file_path → ALLOW (no absolute path to check)
(() => {
  const { tmp } = setupFixture();
  try {
    const r = runHook({ file_path: 'src/relative.cs' });
    assertEq('5. allows relative file_path', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 6: file_path outside any repo → ALLOW (defensive, can't find repo root)
(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hook-test-'));
  try {
    const r = runHook({ file_path: path.join(tmp, 'no-repo.cs') });
    assertEq('6. allows file_path outside any repo', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 7: TEAMMATE block message (exit 2) names the worktree path
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook({ file_path: path.join(repo, 'src', 'leak.cs') });
    // Windows may report short-form paths (SEBAST~1 vs SebastianWesselhoff)
    // so we assert on the structural marker + agent-test segment instead of
    // string-equality with the raw fixture path.
    const ok = r.status === 2
      && r.stderr.includes('FRW-BL-022')
      && /agent-test/.test(r.stderr)
      && /\.claude[/\\]worktrees/.test(r.stderr);
    assertEq('7. teammate block message points at the right worktree path', ok, true);
  } finally { cleanup(tmp); }
})();

// Test 8: AGENT-TOOL SUBAGENT (no TEAMS_MEMBER, native confirmed) → ADVISE (exit 0)
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook(
      { file_path: path.join(repo, 'src', 'leak.cs') },
      { CLAUDE_AGENT_TEAMS_MEMBER: '', CLAUDE_AGENT_TYPE: 'developer' },
    );
    const ok = r.status === 0
      && /advisory/i.test(r.stderr)
      && /agent-test/.test(r.stderr)
      && /\.claude[/\\]worktrees/.test(r.stderr);
    assertEq('8. advises (exit 0) for Agent-tool subagent — native guard blocks', ok, true);
  } finally { cleanup(tmp); }
})();

// ---------------------------------------------------------------------------
// FRW-BL-093 — NotebookEdit is a sibling writer with a different field name
// ---------------------------------------------------------------------------
// The guard read tool_input.file_path only. NotebookEdit writes files too but passes
// notebook_path, so adding it to the Write|Edit matcher WITHOUT this change would register a hook
// that inspects undefined and waves every notebook write through — reading as covered while
// covering nothing. Tests 9-12 drive the REAL hook process with a NotebookEdit-shaped payload.

// Test 9: TEAMMATE notebook write outside the worktree → BLOCK (exit 2)
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook({ notebook_path: path.join(repo, 'src', 'leak.ipynb') });
    assertEq('9. blocks teammate notebook_path write outside worktree (exit 2)', r.status, 2);
  } finally { cleanup(tmp); }
})();

// Test 10: notebook write INSIDE the worktree → ALLOW
(() => {
  const { tmp, wt } = setupFixture();
  try {
    const r = runHook({ notebook_path: path.join(wt, 'src', 'inside.ipynb') });
    assertEq('10. allows notebook_path write inside the worktree', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Test 11: the remediation message names the field the caller actually passed, not a field
// they never sent — telling a NotebookEdit caller to fix their "file_path" is a dead end.
(() => {
  const { tmp, repo } = setupFixture();
  try {
    const r = runHook({ notebook_path: path.join(repo, 'src', 'leak.ipynb') });
    const ok = r.status === 2
      && /Your notebook_path must start with your worktree root/.test(r.stderr)
      && !/Your file_path must start/.test(r.stderr);
    assertEq('11. message names notebook_path, not file_path', ok, true);
  } finally { cleanup(tmp); }
})();

// Test 12: file_path still wins when both are present, and Write/Edit behaviour is unchanged.
(() => {
  const { tmp, repo, wt } = setupFixture();
  try {
    const r = runHook({
      file_path: path.join(wt, 'src', 'inside.cs'),
      notebook_path: path.join(repo, 'src', 'leak.ipynb'),
    });
    assertEq('12. file_path takes precedence when both fields are present', r.status, 0);
  } finally { cleanup(tmp); }
})();

// Counter-proof: the PRE-FIX resolver (file_path only) sees NOTHING in a NotebookEdit payload,
// so the hook returned early and every notebook write passed. Without this, tests 9-11 would
// restate the fix rather than catch its regression.
(() => {
  const { resolveWriteTarget } = require('./enforce-worktree-path-write.js');
  const notebookPayload = { notebook_path: 'C:/repo/src/leak.ipynb' };

  const preFix = (t) => (typeof (t || {}).file_path === 'string' ? t.file_path : null);
  assertEq('PRE-FIX resolver finds no target in a NotebookEdit payload (regression is caught)',
    preFix(notebookPayload), null);
  assertEq('post-fix resolver finds the notebook target',
    resolveWriteTarget(notebookPayload).target, 'C:/repo/src/leak.ipynb');
  assertEq('post-fix resolver reports the field name it used',
    resolveWriteTarget(notebookPayload).field, 'notebook_path');
  assertEq('PRE-FIX and post-fix agree on a plain Write payload (no behaviour change)',
    resolveWriteTarget({ file_path: 'C:/repo/a.ts' }).target, preFix({ file_path: 'C:/repo/a.ts' }));
  assertEq('empty/whitespace target is treated as absent, not as a path',
    resolveWriteTarget({ file_path: '   ', notebook_path: '' }).target, null);
  assertEq('non-string target is ignored rather than crashing the guard',
    resolveWriteTarget({ file_path: 42 }).target, null);
  assertEq('missing tool_input entirely is tolerated',
    resolveWriteTarget(undefined).target, null);
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
