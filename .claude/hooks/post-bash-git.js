// post-bash-git.js - PostToolUse:Bash hook
// Logs events for notable git commands. Non-blocking (action already happened).

const { readStdin, apiPost, apiGet, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { execSync } = require('child_process');
const log = createLogger('post-bash-git');

// Matches Volundr-style card IDs: FRW-002, FRW-BL-014A, CLR-FE-001, CARD-FRW-002
// Does NOT match version strings (1.2.3), RFC numbers (RFC-1234 has too few segments
// with uppercase, but we handle that via length guards in the pattern itself).
const CARD_ID_REGEX = /\b[A-Z]{2,8}(?:-[A-Z]{1,8}){0,2}-\d{3,4}[A-Z]?\b/g;

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

  // 3. Card-ID validator: fires on every git commit, for ALL callers (not just teammates).
  //    PostToolUse fires AFTER the commit — we can WARN but not block.
  if (/git\s+commit\b/.test(command)) {
    await validateCardIds();
  }
}

async function validateCardIds() {
  const cwd = process.cwd();

  // Read the commit message of the commit that just landed on HEAD.
  let commitMsg;
  try {
    commitMsg = execSync('git log -1 --pretty=%B HEAD', { cwd, encoding: 'utf8' });
  } catch {
    // Non-git cwd, no commits yet, or git not on PATH — silently skip.
    return;
  }

  // Extract unique card IDs from the full commit message (subject + body).
  const matches = commitMsg.match(CARD_ID_REGEX);
  if (!matches || matches.length === 0) return;

  const uniqueIds = [...new Set(matches)];

  // Look up each card concurrently (bounded by individual 4s apiGet timeout).
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      const card = await apiGet(`/api/cards/${id}`);
      return { id, card };
    })
  );

  for (const { id, card } of results) {
    if (card === null) {
      // 404 or API down — fail-open, no noise. Could be prose tokens.
      log.info('card_not_found', `Card ${id} not found in dashboard, skipping`);
      continue;
    }

    if (card.status === 'backlog') {
      const msg = `WARNING: Card ${id} is still 'backlog' — should it be in_progress retroactively? Commit references a card that hasn't been started yet.`;
      process.stderr.write(msg + '\n');
      log.warn('commit_references_backlog', msg, { cardId: id, status: card.status });

      // Surface in dashboard events feed.
      await apiPost('/api/events', {
        projectId: PROJECT_ID,
        type: 'intervention',
        detail: `commit-references-backlog: ${id}`,
        cardId: id,
      });
    }
    // Any other status (in_progress, done, etc.) — silently OK.
  }
}

if (require.main === module) {
  main().catch((e) => {
    log.error('unhandled_error', e.message, { error: e.stack });
    process.exit(1);
  });
}
