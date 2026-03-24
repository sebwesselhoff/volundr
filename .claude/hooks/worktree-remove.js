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

  // Remove the git worktree
  try {
    // Find the project root (parent of .claude/worktrees/)
    const worktreesDir = path.dirname(worktreePath);
    const claudeDir = path.dirname(worktreesDir);
    const projectRoot = path.dirname(claudeDir);
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    log.warn('worktree_remove_failed', `git worktree remove failed: ${e.message}`, {
      worktreePath,
    });
    // Try cleaning up the directory manually
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
  }

  // Delete the branch if it still exists
  if (mappingData && mappingData.branch) {
    try {
      const worktreesDir = path.dirname(worktreePath);
      const claudeDir = path.dirname(worktreesDir);
      const projectRoot = path.dirname(claudeDir);
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

  const detail = `Worktree removed: ${branchName}${agentType ? ' (' + agentType + ')' : ''}${duration ? ' - ' + duration : ''}`;

  log.info('worktree_removed', detail, { agentId, worktreePath });

  if (PROJECT_ID) {
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'branch_merged',
      detail,
    });
  }
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
