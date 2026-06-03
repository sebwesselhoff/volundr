// post-bash-git.js - PostToolUse:Bash hook
// Logs events for notable git commands. Non-blocking (action already happened).
//
// FRW-BL-043: the git-commit REVIEW path (validateCardIds) is the framework's
// "guardian"-class commit validator. It used to surface a backlog-card warning
// SYNCHRONOUSLY via stderr in the same hook turn. Claude Code's current official
// line adds a BACKGROUND re-wake mechanism (asyncRewake + rewakeMessage — see
// framework/cc-version-baseline.md L33 and CHANGELOG) that lets a hook run its
// work in the background and re-wake the lead with a summary later, instead of
// blocking the turn or making the lead poll the dashboard.
//
// The exact runtime field names for asyncRewake/rewakeMessage are NOT pinned by
// an authoritative schema in this repo, so the re-wake is GATED behind a
// capability check (`detectRewakeCapability`) that probes the hook stdin for an
// advertised capability flag and degrades to the EXISTING synchronous stderr
// behaviour when the capability is absent/uncertain. The existing hook behaviour
// is never broken — worst case we emit the same stderr warning as before.

const { readStdin, apiPost, apiGet, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { execSync } = require('child_process');
const log = createLogger('post-bash-git');

// --- asyncRewake capability detection (defensive) ---------------------------
// Probe the hook input for an advertised background-rewake capability. We do NOT
// assume a single field name; we accept several plausible shapes. If none is
// present we return false and the caller keeps the current synchronous behaviour.
// Setting VLDR_FORCE_REWAKE=1 forces the path on for restart-verification.
function detectRewakeCapability(input) {
  try {
    if (process.env.VLDR_FORCE_REWAKE === '1') return true;
    if (!input || typeof input !== 'object') return false;
    // Candidate advertisement shapes (probe in priority order).
    const caps = input.capabilities || input.hook_capabilities || input.features || {};
    if (caps && (caps.asyncRewake || caps.async_rewake || caps.rewake || caps.rewakeMessage)) return true;
    if (input.supports_async_rewake === true || input.supportsAsyncRewake === true) return true;
    if (input.asyncRewake === true) return true;
    if (Array.isArray(input.supported_outputs) &&
        input.supported_outputs.some(o => /rewake/i.test(String(o)))) return true;
    return false;
  } catch {
    return false;
  }
}

// Emit a background re-wake instruction on stdout. We write BOTH the documented
// camelCase fields (asyncRewake/rewakeMessage) so that whichever the runtime
// honours, the summary reaches the lead. If the runtime ignores unknown stdout
// keys this is a harmless no-op (the dashboard event still recorded the finding).
function emitRewake(summary) {
  try {
    process.stdout.write(JSON.stringify({ asyncRewake: true, rewakeMessage: summary }) + '\n');
    return true;
  } catch {
    return false;
  }
}

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
  //    FRW-BL-043: pass the detected rewake capability so the validator either
  //    re-wakes the lead in the background (when supported) or degrades to the
  //    existing synchronous stderr warning (when not).
  if (/git\s+commit\b/.test(command)) {
    const canRewake = detectRewakeCapability(input);
    await validateCardIds(canRewake);
  }
}

async function validateCardIds(canRewake = false) {
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

  const backlogFindings = [];
  for (const { id, card } of results) {
    if (card === null) {
      // 404 or API down — fail-open, no noise. Could be prose tokens.
      log.info('card_not_found', `Card ${id} not found in dashboard, skipping`);
      continue;
    }

    if (card.status === 'backlog') {
      const msg = `Card ${id} is still 'backlog' — should it be in_progress retroactively? Commit references a card that hasn't been started yet.`;
      log.warn('commit_references_backlog', msg, { cardId: id, status: card.status });
      backlogFindings.push({ id, msg });

      // Surface in dashboard events feed (always — independent of how we notify the lead).
      await apiPost('/api/events', {
        projectId: PROJECT_ID,
        type: 'intervention',
        detail: `commit-references-backlog: ${id}`,
        cardId: id,
      });
    }
    // Any other status (in_progress, done, etc.) — silently OK.
  }

  if (backlogFindings.length === 0) return;

  // FRW-BL-043: notify the lead. The review work (git log + N card lookups) has
  // already run; we now either re-wake the lead in the BACKGROUND with a summary
  // (native asyncRewake/rewakeMessage, when the runtime advertises it) or fall
  // back to the prior synchronous stderr warning. Either way the finding is also
  // already on the dashboard events feed above, so nothing is ever lost.
  const summary = backlogFindings.length === 1
    ? `Commit review: ${backlogFindings[0].msg}`
    : `Commit review: ${backlogFindings.length} referenced card(s) still in 'backlog': ${backlogFindings.map(f => f.id).join(', ')}. Move them to in_progress retroactively?`;

  let rewoke = false;
  if (canRewake) {
    rewoke = emitRewake(summary);
    if (rewoke) log.info('rewake_emitted', `asyncRewake summary sent to lead: ${summary.slice(0, 120)}`);
  }
  if (!rewoke) {
    // Degrade to the original behaviour: synchronous stderr warning(s).
    for (const f of backlogFindings) {
      process.stderr.write(`WARNING: ${f.msg}\n`);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    log.error('unhandled_error', e.message, { error: e.stack });
    process.exit(1);
  });
}

module.exports = { detectRewakeCapability, emitRewake, CARD_ID_REGEX };
