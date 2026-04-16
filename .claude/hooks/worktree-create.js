// WorktreeCreate hook - create worktree AND track in dashboard
// This hook IS the worktree creation mechanism - must output the path to stdout.
// Input: { name: "slug-name", session_id, agent_id?, agent_type?, ... }
// Output: absolute path to created worktree directory (one line to stdout)

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('worktree-create');

function getWorktreeMapDir() {
  const dir = path.join(os.tmpdir(), 'mc-agent-map', 'worktrees');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  return dir;
}

async function main() {
  const input = readStdin();

  const name = input.name || `wt-${Date.now()}`;
  const agentId = input.agent_id || '';
  const agentType = input.agent_type || '';
  const cwd = input.cwd || process.cwd();

  // Determine project root: use active project path from registry if available,
  // fall back to cwd (which is the Volundr framework repo, not necessarily the target project)
  let projectRoot = cwd;
  try {
    const vldrHome = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
    const regPath = path.join(vldrHome, 'projects', 'registry.json');
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      const activeId = reg.activeProject;
      if (activeId && reg.projects && reg.projects[activeId] && reg.projects[activeId].path) {
        const activePath = reg.projects[activeId].path;
        // Verify the path exists and is a git repo
        if (fs.existsSync(activePath) && fs.existsSync(path.join(activePath, '.git'))) {
          projectRoot = activePath;
          log.info('project_root_resolved', `Using active project path: ${activePath} (project: ${activeId})`);
        }
      }
    }
  } catch (e) {
    log.warn('registry_read_failed', `Could not read registry, falling back to cwd: ${e.message}`);
  }
  const worktreeDir = path.join(projectRoot, '.claude', 'worktrees', name);
  const branch = `worktree/${name}`;

  // Create the worktree using git
  try {
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    execSync(`git worktree add -b "${branch}" "${worktreeDir}" HEAD`, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    log.error('worktree_create_failed', `Failed to create worktree: ${e.message}`, {
      agentId,
      name,
      error: e.stderr ? e.stderr.toString() : e.message,
    });
    process.exit(2); // Block - worktree creation failed
  }

  log.info('worktree_created', `Worktree created: ${branch} at ${worktreeDir}`, {
    agentId,
    agentType,
    worktreePath: worktreeDir,
    branch,
  });

  // Save mapping for WorktreeRemove to read
  const mapKey = Buffer.from(worktreeDir).toString('base64url').slice(0, 60);
  const mapFile = path.join(getWorktreeMapDir(), mapKey);
  try {
    fs.writeFileSync(mapFile, JSON.stringify({
      path: worktreeDir,
      branch,
      name,
      agentId,
      agentType,
      createdAt: new Date().toISOString(),
    }));
  } catch (e) {
    log.warn('mapping_write_failed', `Could not write worktree mapping: ${e.message}`);
  }

  // Log event to dashboard (non-blocking - don't let API failure block worktree)
  if (PROJECT_ID) {
    apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'agent_spawned',
      detail: `Worktree created: ${branch} (${agentType || 'unknown'})`,
    }).catch(() => {});
  }

  // Output the worktree path - this is required by the contract
  process.stdout.write(worktreeDir);
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
  process.exit(2);
});
