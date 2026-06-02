// enforce-worktree-path-write.js - PreToolUse:Write|Edit hook
//
// FRW-BL-027 (conditional enforcement as of 2026-06-02): Claude Code's NATIVE
// worktree-isolation guard (worktree.bgIsolation, default "worktree"; subagent
// coverage fixed in v2.1.154) now BLOCKS the exact bug this hook was written for
// (FRW-BL-022) — but that was VERIFIED LIVE for only ONE surface. On CLI 2.1.161 a
// probe disabled this hook and confirmed the native guard refuses an out-of-worktree
// Write by an **Agent-tool isolation:"worktree" subagent** ("This agent is isolated
// in the worktree ... Edit the worktree copy of this file instead of the
// shared-checkout path."). Native coverage of **Agent Teams teammates**
// (CLAUDE_AGENT_TEAMS_MEMBER — a different launch path, and the surface FRW-BL-022
// actually hit) is NOT yet live-verified. So this hook splits by context:
//   * Agent-tool subagent (native confirmed) → ADVISORY only (log.warn + stderr,
//     exit 0). Native is the sole enforcer; no double-block / 3s-spawn race.
//   * Agent Teams teammate (native unverified) → keep the HARD BLOCK (exit 2) as
//     defense-in-depth. The custom block fires first (PreToolUse), so native is
//     never reached for that call → still no double-block.
// Neither path double-blocks. If native teammate coverage is later verified, the
// teammate branch can collapse to advisory too. See "Forbidden settings"
// (worktree.bgIsolation:"none") in cc-version-baseline.md.
//
// FRW-BL-022 history: blocked Write/Edit calls that target a file path INSIDE a
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

  // file is inside the repo but outside every worktree.
  // FRW-BL-027 conditional enforcement (see header): block for teammate contexts
  // where native coverage is unverified; advise-only for Agent-tool subagents where
  // the native guard is confirmed. Either way exactly one layer acts → no double-block.
  const detail = [
    `  file:     ${normFile}`,
    `  repoRoot: ${normRoot}`,
    `  worktrees: ${worktrees.length} active`,
    'Your file_path must start with your worktree root, NOT the parent repo root.',
    'Active worktrees on this repo:',
    ...worktrees.map((w) => '  - ' + w),
  ];

  if (process.env.CLAUDE_AGENT_TEAMS_MEMBER) {
    // Agent Teams teammate: native bgIsolation coverage NOT live-verified for this
    // launch path (the surface FRW-BL-022 hit). Keep the hard block as defense-in-depth.
    const msg = ['BLOCKED (FRW-BL-022/027): Write/Edit target is OUTSIDE every active worktree', ...detail].join('\n');
    log.warn('worktree_path_bypass_blocked', msg, { file: normFile, repoRoot: normRoot, ctx: 'teammate' });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }

  // Agent-tool subagent: native guard confirmed (live probe 2026-06-02, CLI 2.1.161).
  // Advisory only — native is the sole enforcer for this call; no double-block / race.
  const msg = ['[advisory] Write/Edit target is OUTSIDE every active worktree (Claude Code\'s native worktree-isolation guard will block this during tool execution).', ...detail].join('\n');
  log.warn('worktree_path_out_of_tree_advisory', msg, { file: normFile, repoRoot: normRoot, ctx: 'subagent' });
  process.stderr.write(msg + '\n');
  // Intentionally NO process.exit(2): native guard enforces for Agent-tool subagents.
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
