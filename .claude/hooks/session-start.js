// SessionStart hook - crash recovery + clean boot
// Fires when any Claude Code session starts
// Cleans up orphaned agents from previous sessions (crash/alt-f4 recovery)

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = createLogger('session-start');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const input = readStdin();

  // Only handle lead/standalone sessions - teammates are tracked by SubagentStart
  if (input.team_name && input.teammate_name) return;

  if (input.source === 'startup') {
    // Retry up to 3 times - dashboard may still be starting
    let projects = null;
    for (let i = 0; i < 3; i++) {
      projects = await apiGet('/api/projects');
      if (projects) break;
      log.warn('api_retry', `Dashboard not ready, attempt ${i + 1}/3`);
      await sleep(2000);
    }
    if (!projects) {
      log.error('api_unavailable', 'Dashboard unreachable after 3 attempts - skipping crash recovery');
    } else {
      // Crash recovery: find and clean up ALL orphaned "running" agents across ALL projects
      let totalCleaned = 0;
      const now = new Date().toISOString();

      for (const project of projects) {
        const agents = await apiGet(`/api/projects/${project.id}/agents?status=running`);
        if (!agents || agents.length === 0) continue;

        for (const agent of agents) {
          await apiPatch(`/api/agents/${agent.id}`, {
            status: 'completed',
            completedAt: now,
          });
          log.info('agent_cleaned', `Cleaned orphaned agent: ${agent.id}`, { agentId: agent.id, projectId: project.id });
          totalCleaned++;
        }

        if (agents.length > 0) {
          await apiPost('/api/events', {
            projectId: project.id,
            type: 'agent_completed',
            detail: `Boot recovery: ${agents.length} stale agent(s) cleaned up`,
          });
        }
      }

      if (totalCleaned > 0) {
        // Log to whatever project was last active (or first available)
        const logProject = PROJECT_ID || (projects[0] && projects[0].id);
        if (logProject) {
          await apiPost('/api/events', {
            projectId: logProject,
            type: 'intervention',
            detail: `Session boot: cleaned ${totalCleaned} orphaned running agent(s) across ${projects.length} project(s)`,
          });
        }
        log.info('crash_recovery', `Boot recovery complete: cleaned ${totalCleaned} orphaned agent(s) across ${projects.length} project(s)`);
      }
    }
  } else {
    log.info('skip_crash_recovery', `Non-startup source: ${input.source} - skipping crash recovery, running map cleanup only`);
  }

  // Clean up agent mapping files ONLY on startup - not on resume/clear/compact
  // Resume/compact may fire while agents from this session are still in-flight.
  // Cleaning mappings mid-session would orphan those agents.
  if (input.source === 'startup') {
    const mapDir = path.join(os.tmpdir(), 'mc-agent-map');
    try {
      const files = fs.readdirSync(mapDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(mapDir, f)); } catch (e) { /* ignore */ }
      }
      if (files.length > 0) {
        log.info('agent_maps_cleaned', `Cleaned ${files.length} stale agent mapping(s) from prior session`);
      }
    } catch (e) { /* map dir doesn't exist yet - fine */ }
  }

  // HOT tier context injection - assemble and output as additionalContext
  const hotProjectId = process.env.VLDR_PROJECT_ID;
  if (hotProjectId) {
    try {
      const project = await apiGet(`/api/projects/${hotProjectId}`);
      const cards = await apiGet(`/api/projects/${hotProjectId}/cards`);
      const sessions = await apiGet(`/api/projects/${hotProjectId}/session-summaries?limit=1`);

      if (project && cards) {
        const statusCounts = {};
        (Array.isArray(cards) ? cards : []).forEach(c => {
          statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
        });

        let hotContext = `## HOT Tier Context (auto-injected)\n`;
        hotContext += `Project: ${project.name} | Phase: ${project.phase} | Gate: Level ${project.reviewGateLevel}\n`;
        hotContext += `Cards: ${JSON.stringify(statusCounts)}\n`;

        if (sessions && Array.isArray(sessions) && sessions.length > 0) {
          hotContext += `Last session: ${(sessions[0].summary || '').substring(0, 300)}\n`;
        }

        // Load steering rules from constraints.md
        const mcHome = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
        const constraintsPath = path.join(mcHome, 'projects', hotProjectId, 'constraints.md');
        if (fs.existsSync(constraintsPath)) {
          const content = fs.readFileSync(constraintsPath, 'utf-8');
          const rulesMatch = content.match(/## Steering Rules\n([\s\S]*?)(?=\n## |$)/);
          if (rulesMatch) {
            const rules = rulesMatch[1].trim().split('\n')
              .filter(l => l.startsWith('- [CARD-'))
              .slice(-5);
            if (rules.length > 0) {
              hotContext += `\nActive steering rules:\n${rules.join('\n')}\n`;
            }
          }
        }

        console.log(JSON.stringify({ additionalContext: hotContext }));
      }
    } catch (e) {
      // Non-fatal - Volundr loads manually if hook injection fails
    }
  }

  // TODO: Wire CLAUDE_CODE_TASK_LIST_ID to active project for ambient progress visibility
  // Currently not possible from a hook - process.env changes in child processes don't propagate
  // to the parent Claude Code session. Needs to be set in settings.json env or via start script.
  // For now, set it manually in settings.json when starting a project:
  //   "CLAUDE_CODE_TASK_LIST_ID": "{project-id}"

  // NOTE: Do NOT create a volundr agent here.
  // Volundr agent is created when the user picks a project during the boot sequence.
  // The system-instructions.md boot flow handles: ask project → set activeProject → register volundr.
}

main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
