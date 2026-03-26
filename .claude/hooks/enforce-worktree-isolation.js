// enforce-worktree-isolation.js - PreToolUse:Bash hook
// Blocks teammates from committing directly to main/master.
// Uses pure path logic — detects worktree branches from cwd. HARD enforcement.
// Only active in teammate contexts (CLAUDE_AGENT_TEAMS_MEMBER env var set).

const { readStdin } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('enforce-worktree-isolation');

function main() {
  // Only enforce in teammate contexts
  if (!process.env.CLAUDE_AGENT_TEAMS_MEMBER) return;

  const input = readStdin();
  const command = input.tool_input?.command || '';

  // Only check git commit commands
  if (!/git\s+commit\b/.test(command)) return;

  // Detect branch from cwd: worktrees live under .claude/worktrees/<branch-name>
  // If cwd does NOT contain a worktree path, we're on the main checkout → block.
  const cwd = process.cwd();
  const isInWorktree = cwd.includes('/.claude/worktrees/') || cwd.includes('\\.claude\\worktrees\\');
  if (!isInWorktree) {
    const msg = 'BLOCKED: Teammates cannot commit directly to the main checkout. Use the EnterWorktree tool to work on a feature branch.';
    log.warn('worktree_isolation_blocked', msg, { cwd });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
}

main();
