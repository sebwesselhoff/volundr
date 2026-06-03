// SessionStart hook - crash recovery + clean boot
// Fires when any Claude Code session starts
// Cleans up orphaned agents from previous sessions (crash/alt-f4 recovery)

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { defangMarkers } = require('./memory-guard');
const { wrapAllMemory } = require('./memory-loader');
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

  // FRW-BL-029: record THIS lead session's id. In the normal clean boot, activeProject
  // is null at SessionStart, so the mother Volundr is registered later by the boot
  // sequence (after project selection) — which reads this file to write the
  // session-<id> → dashboard-id map used for concurrent-session-safe parent attribution
  // in agent-start.js. Written unconditionally; harmless if unused.
  if (input.session_id) {
    try {
      const mapDir = path.join(os.tmpdir(), 'mc-agent-map');
      fs.mkdirSync(mapDir, { recursive: true });
      fs.writeFileSync(path.join(mapDir, 'current-session'), input.session_id);
    } catch (e) { /* ignore */ }
  }

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

    // Clean up stale team directories from prior sessions
    // Teams that weren't properly deleted (crash, timeout, etc.) leave directories in ~/.claude/teams/
    // The 'default' directory is Claude Code's internal — never delete it.
    const teamsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'teams');
    try {
      const teamDirs = fs.readdirSync(teamsDir).filter(d => d !== 'default');
      let cleanedTeams = 0;
      for (const teamDir of teamDirs) {
        const teamPath = path.join(teamsDir, teamDir);
        try {
          // Recursively remove the team directory and all contents
          const removeDir = (dir) => {
            for (const entry of fs.readdirSync(dir)) {
              const entryPath = path.join(dir, entry);
              if (fs.statSync(entryPath).isDirectory()) removeDir(entryPath);
              else fs.unlinkSync(entryPath);
            }
            fs.rmdirSync(dir);
          };
          removeDir(teamPath);
          cleanedTeams++;
        } catch (e) {
          log.debug('team_cleanup_failed', `Could not remove stale team dir ${teamDir}: ${e.message}`);
        }
      }
      if (cleanedTeams > 0) {
        log.info('stale_teams_cleaned', `Cleaned ${cleanedTeams} stale team director(ies) from prior session`);
      }
    } catch (e) { /* teams dir doesn't exist - fine */ }
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

        // FRW-BL-048: project.name is user-authored → sanitize before raw interpolation
        // (strip newlines + defang fence markers + cap length) so it can't carry an injection.
        const safeName = defangMarkers(String(project.name ?? '').replace(/[\r\n]+/g, ' ')).slice(0, 120);
        let hotContext = `## HOT Tier Context (auto-injected)\n`;
        hotContext += `Project: ${safeName} | Phase: ${project.phase} | Gate: Level ${project.reviewGateLevel}\n`;
        hotContext += `Cards: ${JSON.stringify(statusCounts)}\n`;

        // FRW-BL-048 / FRW-BL-069: free-text persistent memory (last session summary, steering
        // rules) is author-influenced and a prompt-injection vector. Collect it and route it
        // through memory-loader.wrapAllMemory — the single enforced code path that fences each
        // item as untrusted DATA (ignore-embedded-instructions preamble) AND gates it with the
        // SIGNED integrity manifest (HMAC key from VLDR_MEMORY_HMAC_KEY, outside VLDR_HOME). A
        // manifest-rewrite attacker who lacks the key cannot forge a valid signature → withheld.
        const mcHome = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
        const memItems = [];
        if (sessions && Array.isArray(sessions) && sessions.length > 0 && sessions[0].summary) {
          memItems.push({ id: String(sessions[0].id ?? 'last'), kind: 'session-summary', content: String(sessions[0].summary).substring(0, 600) });
        }
        const constraintsPath = path.join(mcHome, 'projects', hotProjectId, 'constraints.md');
        if (fs.existsSync(constraintsPath)) {
          const content = fs.readFileSync(constraintsPath, 'utf-8');
          const rulesMatch = content.match(/## Steering Rules\n([\s\S]*?)(?=\n## |$)/);
          if (rulesMatch) {
            const rules = rulesMatch[1].trim().split('\n')
              .filter(l => l.startsWith('- [CARD-'))
              .slice(-5);
            if (rules.length > 0) memItems.push({ id: 'steering', kind: 'steering-rules', content: rules.join('\n') });
          }
        }
        if (memItems.length > 0) {
          // FRW-BL-069: signed-manifest gated wrapping. wrapAllMemory reads the HMAC key from
          // VLDR_MEMORY_HMAC_KEY (outside VLDR_HOME), loads + verifies the signed manifest,
          // withholds tampered/unsigned items, fences trusted items as DATA, and re-signs +
          // persists the manifest. Warnings (unsigned degrade / rewrite attack / tamper) are
          // routed to the structured logger.
          const safe = wrapAllMemory(memItems, {
            warn: (event, msg, meta) => log.warn(event, msg, meta || {}),
          });
          hotContext += `\n${safe.text}\n`;
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

  // Register Volundr agent for the active project
  // This replaces manual POST /api/agents calls in the boot sequence
  if (PROJECT_ID) {
    // Check if a running volundr agent already exists
    const existingAgents = await apiGet(`/api/projects/${PROJECT_ID}/agents?type=volundr&status=running`);
    if (!existingAgents || existingAgents.length === 0) {
      const agent = await apiPost('/api/agents', {
        projectId: PROJECT_ID,
        type: 'volundr',
        model: 'opus-4',
        detail: 'Volundr orchestrator',
      });
      if (agent) {
        log.info('volundr_registered', `Volundr agent registered: ${agent.id}`, { agentId: agent.id });
        // Write mapping so agent-stop can find it
        const mapDir = path.join(os.tmpdir(), 'mc-agent-map');
        try {
          fs.mkdirSync(mapDir, { recursive: true });
          fs.writeFileSync(path.join(mapDir, 'volundr-lead'), agent.id);
          // FRW-BL-029: session-keyed map → concurrent-session-safe parent resolution in agent-start.js
          if (input.session_id) fs.writeFileSync(path.join(mapDir, `session-${input.session_id}`), agent.id);
        } catch (e) { /* ignore */ }
      }
    } else {
      log.info('volundr_exists', `Volundr agent already running: ${existingAgents[0].id}`);
    }

    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'session_started',
      detail: 'Session started — Volundr online',
    });
  }
}

if (require.main === module) {
  main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
}
