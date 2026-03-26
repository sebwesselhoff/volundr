// post-bash-git.js - PostToolUse:Bash hook
// Logs events for notable git commands. Non-blocking (action already happened).

const { readStdin, apiPost, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('post-bash-git');

async function main() {
  const input = readStdin();
  const command = input.tool_input?.command || '';

  // 1. Detect git tag → log milestone
  if (/git\s+tag\b/.test(command)) {
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'milestone_reached',
      detail: `Git tag: ${command.slice(0, 100)}`,
    });
    log.info('milestone_reached', `Git tag detected: ${command.slice(0, 80)}`);
  }

  // 2. Detect teammate committing outside a worktree (SOFT warning)
  // Uses cwd path check — no child_process needed.
  if (/git\s+commit\b/.test(command) && process.env.CLAUDE_AGENT_TEAMS_MEMBER) {
    const cwd = process.cwd();
    const isInWorktree = cwd.includes('/.claude/worktrees/') || cwd.includes('\\.claude\\worktrees\\');
    if (!isInWorktree) {
      log.warn('teammate_main_commit', 'Teammate committed outside a worktree', { cwd });
      process.stderr.write('WARNING: Teammate committed outside a worktree. Use the EnterWorktree tool to work on a feature branch.\n');
    }
  }
}

main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
