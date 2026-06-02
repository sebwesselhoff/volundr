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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
