// SubagentStop hook - mark agent completed in dashboard
// Fires when a subagent or teammate finishes
// BLOCKING on: agent patch failure, transcript unreadable (when agent ID exists)

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { updateHeartbeat } = require('./vldr-heartbeat');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('agent-stop');

function getMapDir() {
  return path.join(os.tmpdir(), 'mc-agent-map');
}

// Parse agent transcript JSONL to extract cumulative token usage with granular cache breakdown
function parseTranscriptTokens(transcriptPath) {
  const result = { inputTokens: 0, completionTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, model: null };
  if (!transcriptPath) return result;
  try {
    const data = fs.readFileSync(transcriptPath, 'utf8');
    const lines = data.trim().split('\n');
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.message && entry.message.usage) {
          const u = entry.message.usage;
          result.inputTokens += (u.input_tokens || 0);
          result.cacheCreationTokens += (u.cache_creation_input_tokens || 0);
          result.cacheReadTokens += (u.cache_read_input_tokens || 0);
          result.completionTokens += (u.output_tokens || 0);
        }
        if (entry.message && entry.message.model && !result.model) {
          result.model = entry.message.model;
        }
      } catch (e) {
        log.debug('transcript_line_parse_error', 'Skipping malformed JSONL line', { error: e.message });
      }
    }
  } catch (e) {
    log.error('transcript_read_failed', `Could not read transcript: ${transcriptPath}`, { error: e.stack });
    return result; // Return zeros - caller decides if this is blocking
  }
  return result;
}

// Map Claude API model IDs to our pricing model names
function normalizeModel(apiModel) {
  if (!apiModel) return null;
  const m = apiModel.toLowerCase();
  if (m.includes('opus')) return 'opus-4';
  if (m.includes('sonnet')) return 'sonnet-4';
  if (m.includes('haiku')) return 'haiku-4';
  return null;
}

async function main() {
  const input = readStdin();

  if (!PROJECT_ID) {
    log.fatal('no_project_id', 'PROJECT_ID is empty - cannot track agent completion');
    process.exit(1);
  }

  log.info('hook_started', `Processing agent stop: ${input.agent_type || 'unknown'}`, {
    agentId: input.agent_id,
  });

  // Parse transcript once - used for both agent update and event logging
  const tokenData = parseTranscriptTokens(input.agent_transcript_path);
  const totalTokens = tokenData.inputTokens + tokenData.completionTokens + tokenData.cacheCreationTokens + tokenData.cacheReadTokens;
  const normalizedModel = normalizeModel(tokenData.model);

  log.info('transcript_parsed', `Tokens: in=${tokenData.inputTokens} cacheCreate=${tokenData.cacheCreationTokens} cacheRead=${tokenData.cacheReadTokens} out=${tokenData.completionTokens} model=${normalizedModel || 'unknown'}`, {
    agentId: input.agent_id,
  });

  // Look up dashboard agent ID from mapping file
  // NOTE: Do NOT delete the mapping file here - teammates fire SubagentStop multiple times
  // (once per idle/wake cycle). Deleting on first stop loses the mapping for subsequent stops.
  // Mapping files are cleaned up by session-start.js on next boot.
  let dashboardAgentId = null;
  if (input.agent_id) {
    const mapFile = path.join(getMapDir(), input.agent_id);
    try {
      dashboardAgentId = fs.readFileSync(mapFile, 'utf8').trim();
    } catch (e) {
      log.warn('mapping_file_read_failed', `Could not read agent mapping for ${input.agent_id}`, { error: e.message });
    }
  }

  let existing = null;
  if (dashboardAgentId) {
    // Fetch existing agent to accumulate tokens across idle/wake cycles
    // Use project agents list and filter - single-agent GET may not be available yet
    if (PROJECT_ID) {
      const allAgents = await apiGet(`/api/projects/${PROJECT_ID}/agents`);
      if (allAgents) existing = allAgents.find(a => a.id === dashboardAgentId);
    }
    const patchBody = {
      status: 'completed',
      completedAt: new Date().toISOString(),
    };

    // Accumulate tokens - teammates cycle through multiple SubagentStop events,
    // each reporting only that turn's tokens. Add to existing totals.
    if (totalTokens > 0) {
      const prevPrompt = (existing && existing.promptTokens) || 0;
      const prevCompletion = (existing && existing.completionTokens) || 0;
      const prevCacheCreation = (existing && existing.cacheCreationTokens) || 0;
      const prevCacheRead = (existing && existing.cacheReadTokens) || 0;

      patchBody.promptTokens = prevPrompt + tokenData.inputTokens;
      patchBody.completionTokens = prevCompletion + tokenData.completionTokens;
      patchBody.cacheCreationTokens = prevCacheCreation + tokenData.cacheCreationTokens;
      patchBody.cacheReadTokens = prevCacheRead + tokenData.cacheReadTokens;
    }

    // Correct the model based on actual API usage (start hook defaults to sonnet-4)
    if (normalizedModel) {
      patchBody.model = normalizedModel;
    }

    // Retry once on failure - transient API errors should not permanently orphan agents
    let result = await apiPatch(`/api/agents/${dashboardAgentId}`, patchBody);
    if (!result) {
      log.warn('agent_patch_retry', `First PATCH failed for ${dashboardAgentId} - retrying in 1s`);
      await new Promise(r => setTimeout(r, 1000));
      result = await apiPatch(`/api/agents/${dashboardAgentId}`, patchBody);
    }
    if (!result) {
      log.fatal('agent_patch_failed', `Failed to update agent ${dashboardAgentId} after retry - token data will be lost`, {
        agentId: dashboardAgentId,
        error: 'PATCH /api/agents returned null after 2 attempts',
      });
      process.exit(1);
    }

    const accumulatedTotal = (patchBody.promptTokens || 0) + (patchBody.completionTokens || 0) +
      (patchBody.cacheCreationTokens || 0) + (patchBody.cacheReadTokens || 0);
    log.info('agent_updated', `Agent ${dashboardAgentId} completed: ${accumulatedTotal.toLocaleString()} tokens (turn: ${totalTokens.toLocaleString()}), model=${normalizedModel || 'unknown'}`, {
      agentId: dashboardAgentId,
    });
  } else {
    log.warn('no_dashboard_agent', `No dashboard agent ID found for ${input.agent_id} - completion not tracked`);
  }

  // Use the dashboard agent's detail (set by agent-start with rich description) if available
  const dashboardDetail = (existing && existing.detail) || null;
  const agentLabel = dashboardDetail || input.agent_type || input.agent_id || 'subagent';
  const eventResult = await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'agent_completed',
    detail: `${agentLabel}${totalTokens ? ` (${totalTokens.toLocaleString()} tokens)` : ''}`,
  });
  if (!eventResult) {
    log.warn('event_post_failed', 'Failed to log agent_completed event');
  }

  // Clean name mappings for teammates whose team no longer exists
  // This prevents agent-start from reactivating completed agents after TeamDelete
  if (input.agent_id) {
    const nameFromId = input.agent_id.split('@')[0];
    const teamFromId = input.agent_id.split('@')[1];
    if (teamFromId) {
      const teamDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'teams', teamFromId);
      if (!fs.existsSync(teamDir)) {
        // Team was deleted — clean all name mappings for this agent
        const mapDir = getMapDir();
        try {
          const files = fs.readdirSync(mapDir).filter(f => f.startsWith('name-'));
          for (const f of files) {
            const mapPath = path.join(mapDir, f);
            try {
              const mappedId = fs.readFileSync(mapPath, 'utf8').trim();
              if (mappedId === dashboardAgentId) {
                fs.unlinkSync(mapPath);
                log.info('name_mapping_cleaned', `Cleaned name mapping for ${nameFromId} (team ${teamFromId} deleted)`);
              }
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  // Update Volundr heartbeat — reflect agent completion on dashboard
  await updateHeartbeat('active').catch(() => {});
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
