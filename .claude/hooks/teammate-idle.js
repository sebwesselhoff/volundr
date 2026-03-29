// TeammateIdle hook - build gate check before teammate goes idle
// Exit 0 = teammate can go idle
// Exit 2 = teammate gets stderr feedback and continues working

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('teammate-idle');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const input = readStdin();
  if (!PROJECT_ID) return;

  const cwd = input.cwd || process.cwd();

  // Check if this is a TypeScript project (has tsconfig.json)
  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  if (!hasTsConfig) {
    // Not a TS project - no build gate to run, let teammate idle
    return;
  }

  // Skip root-level tsc in Turborepo monorepos - root tsconfig can't resolve
  // per-package path aliases (@/), so tsc --noEmit always fails from the root.
  // Volundr runs the real build gate (turbo run build) after merging worktrees.
  const hasTurboJson = fs.existsSync(path.join(cwd, 'turbo.json'));
  if (hasTurboJson) {
    log.info('turbo_skip', `Skipping tsc build gate for ${input.teammate_name || 'teammate'} - Turborepo root (Volundr handles build gate after merge)`);
    return;
  }

  // Run type check as build gate
  try {
    execSync('npx tsc --noEmit', {
      cwd,
      timeout: 25000, // Leave 5s buffer before hook timeout (30s)
      stdio: 'pipe',
    });
  } catch (err) {
    const stderr = (err.stderr || err.stdout || '').toString().slice(0, 500);

    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'build_gate_failed',
      detail: `Build gate failed for ${input.teammate_name || 'teammate'}: ${stderr.slice(0, 100)}`,
    });

    log.warn('build_gate_failed', `Build gate failed for ${input.teammate_name || 'teammate'}`, { error: stderr });

    // Write to stderr - Claude Code sends this as feedback to the teammate
    process.stderr.write(
      `Build gate failed. Fix these type errors before stopping:\n${stderr}\n`
    );
    process.exit(2); // Block idle, teammate continues working
  }

  // Build gate passed
  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'build_gate_passed',
    detail: `Build gate passed for ${input.teammate_name || 'teammate'}`,
  });

  log.info('build_gate_passed', `Build gate passed for ${input.teammate_name || 'teammate'}`);

  // --- Team cleanup check ---
  // After build gate passes, check if ALL teammates in this team are idle/done.
  // If so, nudge Volundr to call TeamDelete via stderr prompt (exit 0, not exit 2).
  await checkTeamCompletion(input);

  // Exit 0 = teammate can go idle
}

/**
 * Check if all teammates in the team have completed their tasks.
 * If every task is completed and no teammates are actively working,
 * write a nudge to stdout so Volundr knows to clean up the team.
 * This does NOT block the teammate (always exits 0 after).
 */
async function checkTeamCompletion(input) {
  const teamName = input.team_name;
  if (!teamName) return;

  try {
    const homeDir = require('os').homedir();
    const configPath = path.join(homeDir, '.claude', 'teams', teamName, 'config.json');
    if (!fs.existsSync(configPath)) return;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const members = config.members || [];
    // Don't check if team has fewer than 2 members (just the lead)
    if (members.length < 2) return;

    // Check task list - are all tasks completed?
    const tasksDir = path.join(homeDir, '.claude', 'tasks', teamName);
    if (!fs.existsSync(tasksDir)) return;

    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
    let allDone = true;
    let totalTasks = 0;

    for (const tf of taskFiles) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(tasksDir, tf), 'utf8'));
        if (task.status && task.status !== 'completed' && task.status !== 'cancelled') {
          allDone = false;
          break;
        }
        totalTasks++;
      } catch { /* skip malformed */ }
    }

    if (allDone && totalTasks > 0) {
      log.info('team_all_tasks_done', `All ${totalTasks} tasks completed in team "${teamName}". Nudging Volundr to clean up.`);

      await apiPost('/api/events', {
        projectId: PROJECT_ID,
        type: 'insight',
        detail: `Team "${teamName}": all ${totalTasks} tasks completed. All teammates idle. Team can be deleted.`,
      });

      // Write to stdout - this shows up as context for Volundr
      process.stdout.write(
        `\n[team-cleanup] All ${totalTasks} tasks in team "${teamName}" are completed and all teammates are idle. ` +
        `Call TeamDelete to clean up the team.\n`
      );
    }
  } catch (e) {
    log.error('team_check_error', e.message);
    // Never block on check errors
  }
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
  // Never block on hook errors - let teammate idle
  process.exit(0);
});
