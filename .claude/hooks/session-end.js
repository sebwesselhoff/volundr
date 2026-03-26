// SessionEnd hook - clean shutdown on true session termination
// Fires ONCE when the session actually ends (not mid-session like Stop)
// Handles: complete running agents, clear activeProject, log session_ended
// Timeout: controlled by CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS (we set to 5000ms)

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID, VLDR_HOME } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const fs = require('fs');
const path = require('path');

const log = createLogger('session-end');

async function main() {
  const input = readStdin();

  // Only handle real exits, not clear (which keeps the session alive)
  const reason = input.reason || 'unknown';
  if (reason === 'clear') {
    log.info('skip_clear', 'SessionEnd reason=clear - session continues, skipping cleanup');
    return;
  }

  log.info('session_ending', `Session ending: reason=${reason}`, {
    agentId: null,
  });

  // Complete all running agents for the active project
  if (PROJECT_ID) {
    const agents = await apiGet(`/api/projects/${PROJECT_ID}/agents?status=running`);
    if (agents && agents.length > 0) {
      const now = new Date().toISOString();
      // Complete all agents concurrently - they're independent, and we have limited time (5s budget)
      await Promise.all(agents.map(agent =>
        apiPatch(`/api/agents/${agent.id}`, { status: 'completed', completedAt: now })
      ));
      log.info('agents_completed', `Completed ${agents.length} running agent(s) on session end`);
    }

    // Log session ended event
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'session_ended',
      detail: `Session ended: reason=${reason}`,
    });
  }

  // Session summary check: auto-create a minimal summary if none exists recently
  if (PROJECT_ID) {
    const summaries = await apiGet(`/api/projects/${PROJECT_ID}/session-summaries?limit=1`);
    const recentSummary = summaries && summaries.length > 0 && summaries[0];
    const summaryAge = recentSummary ? (Date.now() - new Date(recentSummary.startedAt).getTime()) : Infinity;

    // If no summary in the last 2 hours, create a minimal one
    if (summaryAge > 2 * 60 * 60 * 1000) {
      const cards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
      const done = cards ? cards.filter(c => c.status === 'done').length : 0;
      const total = cards ? cards.length : 0;
      await apiPost('/api/session-summaries', {
        projectId: PROJECT_ID,
        startedAt: new Date(Date.now() - 3600000).toISOString(), // approximate
        endedAt: new Date().toISOString(),
        summary: `Auto-generated: Session ended without explicit summary. Progress: ${done}/${total} cards done.`,
      });
      log.info('auto_summary_created', `Created auto session summary (${done}/${total} cards)`);
    }
  }

  // Clear activeProject in registry.json
  const registryPath = path.join(VLDR_HOME, 'projects', 'registry.json');
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (registry.activeProject) {
      const prev = registry.activeProject;
      registry.activeProject = null;
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      log.info('active_project_cleared', `Cleared activeProject (was: ${prev})`);
    }
  } catch (e) {
    log.warn('registry_update_failed', `Could not clear activeProject: ${e.message}`);
  }
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
  // Never block session exit
});
