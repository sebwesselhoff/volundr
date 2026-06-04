// enforce-worktree-isolation.js - PreToolUse:Bash hook
// Blocks teammates from committing directly to main/master.
// PRIMARY detection: uses workspace.git_worktree from Claude Code hook-input JSON on stdin.
// FALLBACK detection (older CC builds): cwd-substring check for .claude/worktrees/ path.
// Only active in teammate contexts (CLAUDE_AGENT_TEAMS_MEMBER env var set).

const { readStdin } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('enforce-worktree-isolation');

/**
 * Determine whether the current execution context is inside a worktree.
 *
 * @param {object|null} input - Parsed hook-input JSON from stdin (may be null/undefined).
 * @param {string} cwd - The current working directory (process.cwd()).
 * @returns {boolean} true if running inside a worktree, false if on the main checkout.
 */
function isInWorktree(input, cwd) {
  // PRIMARY: native Claude Code hook-input field workspace.git_worktree.
  // Only engage if workspace is a non-null object AND the key git_worktree is explicitly
  // present on it (truthy → in a worktree; falsy/null → main checkout).
  // If git_worktree is absent from workspace (older CC build that omits the field),
  // fall through to the cwd-substring fallback below.
  if (input && input.workspace !== null && typeof input.workspace === 'object'
      && 'git_worktree' in input.workspace) {
    return !!input.workspace.git_worktree;
  }

  // FALLBACK: older CC builds that do not expose workspace.git_worktree.
  // Worktrees live under .claude/worktrees/<branch-name> (forward or back slashes).
  return cwd.includes('/.claude/worktrees/') || cwd.includes('\\.claude\\worktrees\\');
}

function main() {
  // Only enforce in teammate contexts
  if (!process.env.CLAUDE_AGENT_TEAMS_MEMBER) return;

  const input = readStdin();
  const command = input.tool_input?.command || '';

  // Only check git commit commands
  if (!/git\s+commit\b/.test(command)) return;

  const cwd = process.cwd();
  if (!isInWorktree(input, cwd)) {
    const msg = 'BLOCKED: Teammates cannot commit directly to the main checkout. Use the EnterWorktree tool to work on a feature branch.';
    log.warn('worktree_isolation_blocked', msg, { cwd });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { isInWorktree };
