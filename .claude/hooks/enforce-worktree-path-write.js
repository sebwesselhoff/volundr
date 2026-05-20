// enforce-worktree-path-write.js - PreToolUse:Write|Edit hook
// FRW-BL-022 fix: blocks Write/Edit calls that target a file path INSIDE a
// parent repository that has active worktrees, when the path is OUTSIDE
// every active worktree. The dev subagent is meant to write into its own
// worktree directory; writing to the parent repo's working tree pollutes
// main and requires 15-30 min of manual recovery per incident.
//
// Why this exists: the Agent tool's isolation: "worktree" creates a fresh
// branch + working dir, but doesn't bind subagent file-resolution to that
// dir. The subagent's Write tool accepts absolute paths; devs default to
// the parent repo path (e.g. C:/.../clear/clear-api/...) instead of the
// worktree-prefixed path (C:/.../clear/.claude/worktrees/agent-XXX/
// clear-api/...). Result: files land on main.
//
// Detection: for each Write/Edit target file_path,
//   1. Normalize to forward slashes
//   2. Walk upward looking for the nearest `.git` directory (= REPO_ROOT)
//   3. If REPO_ROOT/.claude/worktrees/ exists and has at least one entry,
//      worktrees are active for that repo
//   4. If file_path is NOT inside any of those worktree subdirs, BLOCK
//
// Failure mode: false positives if the developer is writing into a repo
// while teammates have active worktrees in that same repo. Gated on
// CLAUDE_AGENT_TEAMS_MEMBER OR CLAUDE_AGENT_TYPE so it only fires for
// subagent / teammate contexts.

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');

const log = createLogger('enforce-worktree-path-write');

function normalize(p) {
  return (p || '').replace(/\\/g, '/');
}

function findRepoRoot(filePath) {
  // Walk up looking for a .git file or directory.
  let dir = path.dirname(filePath);
  for (let i = 0; i < 32 && dir; i++) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
    } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function listActiveWorktrees(repoRoot) {
  const worktreesDir = path.join(repoRoot, '.claude', 'worktrees');
  try {
    if (!fs.existsSync(worktreesDir)) return [];
    return fs.readdirSync(worktreesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => normalize(path.join(worktreesDir, e.name)));
  } catch {
    return [];
  }
}

function main() {
  // Only enforce in subagent / teammate contexts. The main Volundr session
  // intentionally writes outside worktrees (e.g. recovery from prior dev
  // bypass), so we don't want to block it.
  const isSubagent = !!process.env.CLAUDE_AGENT_TEAMS_MEMBER
    || !!process.env.CLAUDE_AGENT_TYPE
    || !!process.env.CLAUDE_SUBAGENT_NAME
    || !!process.env.CLAUDE_AGENT_ID;
  if (!isSubagent) return;

  const input = readStdin();
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;
  if (!filePath || typeof filePath !== 'string') return;

  // Only check absolute paths — relative paths resolve against CWD which is
  // typically the worktree itself, so they're safe by default.
  if (!path.isAbsolute(filePath)) return;

  const normFile = normalize(filePath);

  const repoRoot = findRepoRoot(filePath);
  if (!repoRoot) return;
  const normRoot = normalize(repoRoot);

  const worktrees = listActiveWorktrees(repoRoot);
  if (worktrees.length === 0) return; // no worktrees, no bypass concern

  // Is file inside ANY worktree? Then allow.
  const insideAnyWorktree = worktrees.some(
    (wt) => normFile === wt || normFile.startsWith(wt + '/'),
  );
  if (insideAnyWorktree) return;

  // file is inside the repo but outside every worktree → block
  const msg = [
    'BLOCKED (FRW-BL-022): Write/Edit target is OUTSIDE every active worktree',
    `  file:     ${normFile}`,
    `  repoRoot: ${normRoot}`,
    `  worktrees: ${worktrees.length} active`,
    '',
    'You are a subagent spawned with isolation: "worktree". Your file_path',
    'must start with your worktree root, NOT the parent repo root.',
    '',
    'Replace the leading repo path with your worktree path. Example:',
    `  WRONG: ${normRoot}/clear-api/Foo.cs`,
    `  RIGHT: ${worktrees[0]}/clear-api/Foo.cs`,
    '',
    'Active worktrees on this repo:',
    ...worktrees.map((w) => '  - ' + w),
  ].join('\n');

  log.warn('worktree_path_bypass_blocked', msg, { file: normFile, repoRoot: normRoot });
  process.stderr.write(msg + '\n');
  process.exit(2);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    // Never crash the parent — log and let the write through.
    try { log.warn('hook_internal_error', e.message); } catch { /* ignore */ }
  }
}

module.exports = { findRepoRoot, listActiveWorktrees, normalize };
