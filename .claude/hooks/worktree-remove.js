// WorktreeRemove hook - track worktree removal and clean up git worktree
// Input: { worktree_path: "/abs/path/to/worktree", session_id, agent_id?, ... }
// Non-blocking - observability and cleanup only

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('worktree-remove');

function getWorktreeMapDir() {
  return path.join(os.tmpdir(), 'mc-agent-map', 'worktrees');
}

async function main() {
  const input = readStdin();

  const worktreePath = input.worktree_path || '';
  const agentId = input.agent_id || '';

  if (!worktreePath) {
    log.warn('no_worktree_path', 'WorktreeRemove fired without worktree_path');
    return;
  }

  // Read mapping data (written by worktree-create.js)
  let mappingData = null;
  const mapKey = Buffer.from(worktreePath).toString('base64url').slice(0, 60);
  const mapFile = path.join(getWorktreeMapDir(), mapKey);
  try {
    mappingData = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    fs.unlinkSync(mapFile);
  } catch (e) { /* no mapping - fine */ }

  // Project root = parent of .claude/worktrees/<name>
  const projectRoot = path.dirname(path.dirname(path.dirname(worktreePath)));

  // Remove the git worktree. git's removal is worktree-aware; if it fails we DO NOT
  // force-recursively delete the directory — that blind delete can clobber in-progress
  // or gitignored files (node_modules, .env, uncommitted work). Native cleanup (CC 2.1.157,
  // unlocked + no-rm-rf) deliberately avoids rm-rf too; we mirror that. On failure we prune
  // stale git metadata (safe) and leave the directory for native / manual cleanup. [FRW-BL-030]
  let removedOk = true;
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    removedOk = false;
    log.warn('worktree_remove_failed', `git worktree remove failed: ${e.message} — pruning metadata, NOT force-deleting (FRW-BL-030)`, { worktreePath });
    try { execSync('git worktree prune', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e2) { /* prune best-effort */ }
  }

  // Delete the branch if it still exists
  if (mappingData && mappingData.branch) {
    try {
      execSync(`git branch -D "${mappingData.branch}"`, {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) { /* branch already deleted or merged - fine */ }
  }

  const duration = mappingData
    ? `${Math.round((Date.now() - new Date(mappingData.createdAt).getTime()) / 1000)}s`
    : '';
  const branchName = (mappingData && mappingData.branch) || path.basename(worktreePath);
  const agentType = (mappingData && mappingData.agentType) || '';

  const detail = `Worktree ${removedOk ? 'removed' : 'remove FAILED — left for native/manual cleanup (no rm-rf)'}: ${branchName}${agentType ? ' (' + agentType + ')' : ''}${duration ? ' - ' + duration : ''}`;

  log.info('worktree_removed', detail, { agentId, worktreePath });

  if (PROJECT_ID) {
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'branch_merged',
      detail,
    });
  }
}

if (require.main === module) {
  main().catch((e) => {
    log.error('unhandled_error', e.message, { error: e.stack });
  });
}
