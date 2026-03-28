// SubagentStart hook - register spawned agent in dashboard
// Fires when any subagent or teammate is spawned
// BLOCKING on: agent registration failure, no PROJECT_ID

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { updateHeartbeat } = require('./vldr-heartbeat');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('agent-start');

function inferAgentType(name) {
  if (!name) return 'developer';
  const lower = name.toLowerCase();
  // v6 teammate types — check specific roles first
  if (lower.includes('architect')) return 'architect';
  if (lower.includes('qa-eng') || lower.includes('qa_eng')) return 'qa-engineer';
  if (lower.includes('devops') || lower.includes('infra')) return 'devops-engineer';
  if (lower.includes('design')) return 'designer';
  if (lower.includes('chaos-engine') || lower.includes('chaos_engine')) return 'chaos-engine-voice';
  if (lower.includes('roundtable') || lower.includes('voice-')) return 'roundtable-voice';
  if (lower.includes('review') || lower.includes('guardian')) return 'review';
  if (lower.includes('research')) return 'researcher';
  if (lower.includes('content') || lower.includes('doc')) return 'content';
  // Developer check BEFORE test — "test-dev" should be developer, not tester
  if (lower.includes('dev') || lower.includes('domain-dev') || lower.includes('domaindev')) return 'developer';
  if (lower.includes('orchestrat') || lower.includes('suborc')) return 'developer';
  if (lower.includes('fix')) return 'developer';
  if (lower.includes('explore')) return 'developer';
  // Tester only if no dev match
  if (lower.includes('test')) return 'tester';
  return 'developer';
}

function getMapDir() {
  const dir = path.join(os.tmpdir(), 'mc-agent-map');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    log.warn('map_dir_create_failed', `Could not create agent map dir: ${dir}`, { error: e.message });
  }
  return dir;
}

function getQueueDir() {
  return path.join(getMapDir(), 'desc-queue');
}

// Stable key for teammate reuse across idle/wake cycles
function getNameKey(agentLabel) {
  const sanitized = agentLabel.replace(/[^a-z0-9-]/gi, '_');
  return `name-${PROJECT_ID}-${sanitized}`;
}


// Read pending description from FIFO queue written by pre-agent-tool.js
// Matches by subagent_type prefix, pops the oldest non-stale entry
// Entries older than 5 minutes are considered stale and deleted
const QUEUE_TTL_MS = 5 * 60 * 1000;

function popDescriptionFromQueue(agentType) {
  const queueDir = getQueueDir();
  const typeKey = (agentType || 'general-purpose').replace(/[^a-z0-9-]/gi, '_');
  const now = Date.now();
  try {
    const files = fs.readdirSync(queueDir)
      .filter(f => f.startsWith(typeKey + '-'))
      .sort(); // oldest first (timestamp in filename)
    for (const file of files) {
      const filePath = path.join(queueDir, file);
      // Extract timestamp from filename: {typeKey}-{timestamp}-{random}
      const parts = file.split('-');
      const tsIndex = typeKey.split('-').length; // skip typeKey segments
      const fileTs = parseInt(parts[tsIndex], 10);
      if (fileTs && (now - fileTs) > QUEUE_TTL_MS) {
        // Stale entry - delete and skip
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        continue;
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      fs.unlinkSync(filePath); // Consume - one entry per spawn
      return data;
    }
  } catch (e) {
    // Queue dir doesn't exist or is empty - normal for first spawn
  }
  return null;
}


// Inject project context into every subagent via additionalContext
// Called on both fresh registration and reactivation paths
function emitAdditionalContext() {
  if (PROJECT_ID) {
    const contextHint = [
      `MC Project: ${PROJECT_ID}`,
      `Dashboard API: ${process.env.VLDR_API_URL || 'http://localhost:3141'}`,
      `Constraints: ~/.volundr/projects/${PROJECT_ID}/constraints.md`,
    ].join('. ');
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: contextHint,
      },
    });
    process.stdout.write(output);
  }
}

async function main() {
  const input = readStdin();

  if (!PROJECT_ID) {
    log.fatal('no_project_id', 'PROJECT_ID is empty - cannot register agent');
    process.exit(1);
  }

  const agentType = inferAgentType(input.agent_type);

  // Pop description + name + cardId + personaId from FIFO queue (written by pre-agent-tool.js)
  const preToolData = popDescriptionFromQueue(input.agent_type);
  const preToolDescription = preToolData ? preToolData.description : null;
  const preToolName = preToolData ? preToolData.name : null;
  let preToolCardId = preToolData ? preToolData.cardId : null;
  let preToolPersonaId = preToolData ? preToolData.personaId : null;

  // Effective agent name: prefer user-given name from Agent tool, fall back to type/id
  const rawAgentName = input.agent_type || input.agent_id || 'subagent';

  // Fallback for teammates: if queue had no card/persona, try reading from the team config
  // Teammates have their prompt stored in ~/.claude/teams/{team}/config.json
  if (!preToolCardId || !preToolPersonaId) {
    try {
      const teamsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'teams');
      const teamDirs = fs.readdirSync(teamsDir).filter(d => {
        try { return fs.statSync(path.join(teamsDir, d)).isDirectory(); } catch { return false; }
      });
      for (const teamDir of teamDirs) {
        const configPath = path.join(teamsDir, teamDir, 'config.json');
        if (!fs.existsSync(configPath)) continue;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const nameToFind = preToolName || rawAgentName || input.agent_type || '';
        const member = (config.members || []).find(m =>
          m.agentId === input.agent_id ||
          m.name === nameToFind ||
          m.name === input.agent_type ||
          (input.agent_id && m.agentId.startsWith(input.agent_id))
        );
        if (member && member.prompt) {
          if (!preToolCardId) {
            const cardMatch = member.prompt.match(/CARD-[A-Z0-9]+-\d{3}/);
            if (cardMatch) preToolCardId = cardMatch[0];
          }
          if (!preToolPersonaId) {
            const personaMatch = member.prompt.match(/personaId[:\s]+["']?([a-z0-9-]+)["']?/i);
            if (personaMatch) preToolPersonaId = personaMatch[1];
          }
          break;
        }
      }
    } catch (e) {
      log.debug('team_config_read_failed', `Could not read team config for card/persona fallback: ${e.message}`);
    }
  }

  const effectiveName = preToolName || rawAgentName;

  // Build label: prefer PreToolUse description, fall back to agent name
  const isGenericType = ['general-purpose', 'Explore', 'Plan'].includes(rawAgentName);
  const agentLabel = preToolDescription
    ? (isGenericType ? preToolDescription : `${effectiveName}: ${preToolDescription}`)
    : effectiveName;

  log.info('hook_started', `Registering ${agentType}: ${agentLabel}`, {
    agentId: input.agent_id,
    effectiveName,
    preToolName: preToolName || '(none)',
  });

  // Determine dedup key:
  // Two paths based on whether pre-agent-tool.js fired (Agent tool spawn vs teammate):
  //
  // 1. preToolData found → Agent tool subagent (pre-agent-tool.js wrote to queue)
  //   - Has preToolName? Use it for dedup (named subagent, e.g. "int0001-scanner")
  //   - No preToolName? Use agent_id (unnamed subagent - prevents parallel dedup)
  //
  // 2. No preToolData → Agent Teams teammate (pre-agent-tool.js never fires for teammates)
  //   - Use rawAgentName for dedup (stable name like "the-architect" survives idle/wake cycles)
  let nameKey;
  if (preToolData) {
    // Agent tool subagent - pre-agent-tool.js fired
    nameKey = preToolName
      ? getNameKey(preToolName)                    // Named: dedup by name
      : `id-${PROJECT_ID}-${input.agent_id}`;     // Unnamed: unique per spawn
  } else {
    // Teammate or other - no pre-agent-tool data
    // Use rawAgentName for dedup (supports idle/wake cycle reuse)
    nameKey = getNameKey(rawAgentName);
  }

  const nameMapFile = path.join(getMapDir(), nameKey);
  let existingDashboardId = null;
  try {
    existingDashboardId = fs.readFileSync(nameMapFile, 'utf8').trim();
  } catch (e) { /* no existing mapping - first spawn */ }

  if (existingDashboardId) {
    // Reactivate existing agent instead of creating a duplicate
    const reopened = await apiPatch(`/api/agents/${existingDashboardId}`, {
      status: 'running',
    });

    if (reopened) {
      // Update CLI→dashboard mapping for this new CLI agent ID
      if (input.agent_id) {
        const mapFile = path.join(getMapDir(), input.agent_id);
        try { fs.writeFileSync(mapFile, existingDashboardId); } catch (e) {
          log.warn('mapping_file_write_failed', `Could not write agent mapping for ${input.agent_id}`, { error: e.message });
        }
      }

      log.info('agent_reactivated', `Reactivated ${agentType} as ${existingDashboardId} (idle/wake cycle)`, {
        agentId: existingDashboardId,
      });

      await apiPost('/api/events', {
        projectId: PROJECT_ID,
        type: 'agent_spawned',
        detail: `${agentType} reactivated: ${agentLabel}`,
      });
      emitAdditionalContext();
      return;
    }
    // If reactivation failed (agent deleted, API error), fall through to fresh creation
    log.warn('reactivation_failed', `Could not reactivate ${existingDashboardId} - creating fresh agent`);
  }

  // Resolve parent agent ID - use hook input if available, otherwise find the volundr agent
  let parentAgentId = null;
  if (input.parent_agent_id) {
    const parentMapFile = path.join(getMapDir(), input.parent_agent_id);
    try {
      parentAgentId = fs.readFileSync(parentMapFile, 'utf8').trim();
    } catch (e) {
      log.debug('parent_mapping_not_found', `No mapping for parent ${input.parent_agent_id}`, { error: e.message });
    }
  }
  if (!parentAgentId) {
    const agents = await apiGet(`/api/projects/${PROJECT_ID}/agents?type=volundr&status=running`);
    if (agents && agents.length > 0) {
      parentAgentId = agents[0].id;
    } else {
      log.warn('no_parent_agent', 'Could not find running volundr agent - registering without parent');
    }
  }

  // Register in dashboard - BLOCKING if this fails
  const agent = await apiPost('/api/agents', {
    projectId: PROJECT_ID,
    type: agentType,
    model: 'sonnet-4', // Default - corrected by agent-stop via transcript parsing
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(preToolCardId ? { cardId: preToolCardId } : {}),
    ...(preToolPersonaId ? { personaId: preToolPersonaId } : {}),
    detail: agentLabel,
  });

  if (!agent) {
    log.fatal('agent_registration_failed', `Failed to register ${agentType}: ${agentLabel} - dashboard tracking broken for this agent`, {
      agentId: input.agent_id,
    });
    process.exit(1);
  }

  log.info('agent_registered', `Registered ${agentType} as ${agent.id}`, {
    agentId: agent.id,
  });

  // Write CLI→dashboard mapping (for agent-stop) and name mapping (for teammate reuse)
  if (agent.id && input.agent_id) {
    const mapFile = path.join(getMapDir(), input.agent_id);
    try {
      fs.writeFileSync(mapFile, agent.id);
    } catch (e) {
      log.warn('mapping_file_write_failed', `Could not write agent mapping for ${input.agent_id}`, { error: e.message });
    }
  }
  if (agent.id) {
    try { fs.writeFileSync(nameMapFile, agent.id); } catch (e) {
      log.warn('name_mapping_write_failed', `Could not write name mapping for ${agentLabel}`, { error: e.message });
    }
  }

  const eventResult = await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'agent_spawned',
    detail: `${agentType} spawned: ${agentLabel}`,
  });
  if (!eventResult) {
    log.warn('event_post_failed', 'Failed to log agent_spawned event');
  }

  emitAdditionalContext();

  // Update Volundr heartbeat — show agent spawn on dashboard
  await updateHeartbeat('spawning agents', preToolCardId).catch(() => {});
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
