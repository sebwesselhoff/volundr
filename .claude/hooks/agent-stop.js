// SubagentStop hook - mark agent completed in dashboard
// Fires when a subagent or teammate finishes
// FATAL (exit 1) on: agent patch failure after retry. Exit 1 is a non-blocking
// hard error — it does NOT retry the agent's turn.
//
// CONTRACT (FRW-BL-028) — this is a SubagentStop hook and MUST NOT block-retry.
// Claude Code caps a Stop/SubagentStop hook at 8 *consecutive blocks* before it
// force-ends the turn with a warning (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, default 8,
// since v2.1.143). A "block" is `process.exit(2)` OR stdout `{"decision":"block"}`.
// This hook only ever exits 0 (success) or 1 (fatal, non-retry) — never 2. Build-gate
// / quality retries belong on TeammateIdle / TaskCompleted (non-Stop events), which
// are NOT subject to this cap. Do not introduce an exit-2 retry loop here.

const { apiGet, apiPatch, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { updateHeartbeat } = require('./vldr-heartbeat');
const { extractCardId } = require('./_cardid');
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
/**
 * FRW-BL-095 — build the PATCH body for one SubagentStop cycle. Pure; exported for the self-test.
 *
 * The whole point of this function existing separately is the thing it must NEVER contain:
 * `status`. SubagentStop fires once per idle/wake cycle — this hook's own comments have said so
 * for a long time, and it accumulated tokens for exactly that reason — yet it also wrote
 * `status: 'completed'` on every one of those cycles. So a working agent read `completed` between
 * turns, `?status=running` undercounted a live fan-out (one row shown during a six-agent wave),
 * and stalled-scan could not tell idle-but-alive from finished.
 *
 * A payload probe settled whether a condition could fix it: the SubagentStop payload has NO
 * finality signal. `stop_hook_active` is hook RE-ENTRANCY, not completion. Since finality is
 * unknowable here, claiming it is the defect — so this returns tokens and model only, and
 * session-end owns the terminal write.
 *
 * Token accumulation is UNCHANGED and deliberately so: each cycle reports only that turn's tokens,
 * and they are added to the row's running totals. That was already correct (an earlier claim that
 * it double-counted was withdrawn after reading the code) and this card must not break it.
 *
 * @returns {object} patch body — possibly EMPTY, which is a legitimate outcome for an idle yield
 *   that produced no tokens and no model change.
 */
function buildStopPatch({ tokenData, existing, normalizedModel } = {}) {
  const patch = {};
  const total = tokenData
    ? (tokenData.inputTokens || 0) + (tokenData.completionTokens || 0)
      + (tokenData.cacheCreationTokens || 0) + (tokenData.cacheReadTokens || 0)
    : 0;
  if (total > 0) {
    patch.promptTokens = ((existing && existing.promptTokens) || 0) + (tokenData.inputTokens || 0);
    patch.completionTokens = ((existing && existing.completionTokens) || 0) + (tokenData.completionTokens || 0);
    patch.cacheCreationTokens = ((existing && existing.cacheCreationTokens) || 0) + (tokenData.cacheCreationTokens || 0);
    patch.cacheReadTokens = ((existing && existing.cacheReadTokens) || 0) + (tokenData.cacheReadTokens || 0);
  }
  if (normalizedModel) patch.model = normalizedModel;
  return patch;
}

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
    // FRW-BL-095: do NOT write terminal status here.
    //
    // This hook's own comments already record that SubagentStop "fires multiple times (once per
    // idle/wake cycle)" and accumulate tokens for exactly that reason — then wrote
    // status:'completed' unconditionally on every one of those cycles anyway. The author saw the
    // repeat-firing, handled its token consequence, and missed its status consequence.
    //
    // A probe captured a real payload and enumerated its fields: agent_id, agent_transcript_path,
    // agent_type, background_tasks, cwd, hook_event_name, last_assistant_message, permission_mode,
    // prompt_id, session_crons, session_id, stop_hook_active, transcript_path. THERE IS NO FINALITY
    // SIGNAL. `stop_hook_active` is hook RE-ENTRANCY, not completion — reading it as completion
    // would have been a plausible and wrong guess. So a payload condition cannot fix this.
    //
    // Since finality is unknowable here, claiming it is the defect. `status` now means lifecycle
    // and is written terminally only by session-end (and the boot orphan sweep); liveness —
    // working / idle / stalled — is COMPUTED by the API from the agent's latest event timestamp
    // (FRW-BL-063), which is what actually answers "is it alive?".
    //
    // The trade, made deliberately: this under-completes (a finished agent reads `running` until
    // session end) where the old code over-completed (a working agent read `completed`, so
    // ?status=running undercounted a live fan-out). Under-completion is bounded and already swept
    // at both ends; over-completion gave wrong answers all session long.
    // Token accumulation (teammates cycle through multiple SubagentStop events, each reporting
    // only that turn's tokens) and FRW-BL-031 model reconciliation both live in buildStopPatch,
    // which is pure and self-tested. The hook calls it rather than duplicating the logic — a
    // tested helper the production path does not use would be worse than no helper at all.
    const patchBody = buildStopPatch({ tokenData, existing, normalizedModel });

    // Retry once on failure - transient API errors should not permanently orphan agents
    // FRW-BL-095: patchBody can now be legitimately EMPTY — this hook no longer writes a status,
    // so a cycle that produced no tokens and no model change has nothing to say. Sending `{}` would
    // be a pointless round trip whose failure would then trip the fatal path below and kill the
    // hook over a no-op.
    if (Object.keys(patchBody).length === 0) {
      log.debug('agent_patch_skipped', `Nothing to update for ${dashboardAgentId} (idle yield, no new tokens)`, {
        agentId: dashboardAgentId,
      });
    } else {
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
    // FRW-BL-095: "yielded", not "completed" — this fires once per idle/wake cycle and we cannot
    // know from here whether it is the last one.
    log.info('agent_updated', `Agent ${dashboardAgentId} yielded: ${accumulatedTotal.toLocaleString()} tokens accumulated (turn: ${totalTokens.toLocaleString()}), model=${normalizedModel || 'unknown'}`, {
      agentId: dashboardAgentId,
    });
    }
  } else {
    // No mapping found — SubagentStart may not have fired (happens for read-only agent types like architect).
    // Register the agent now with completion data so it appears on the dashboard.
    log.info('late_registration', `No mapping for ${input.agent_id} — registering on stop (SubagentStart may not have fired)`);

    // Try to extract card/persona from team config
    // The agent_id may be "name@team" (teammates) or a plain UUID (some agent types)
    // Scan all team configs and match by agent_id or agent_type name
    let cardId = null;
    let personaId = null;
    let agentDetailName = input.agent_type || input.agent_id || 'unknown';
    const nameFromId = input.agent_id ? input.agent_id.split('@')[0] : null;
    const teamFromId = input.agent_id && input.agent_id.includes('@') ? input.agent_id.split('@')[1] : null;
    try {
      const teamsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'teams');
      const teamDirs = fs.readdirSync(teamsDir).filter(d => d !== 'default');
      for (const teamDir of teamDirs) {
        const configPath = path.join(teamsDir, teamDir, 'config.json');
        if (!fs.existsSync(configPath)) continue;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // Match by agent_id (exact or prefix), or by name from agent_id
        const member = (config.members || []).find(m =>
          m.agentId === input.agent_id ||
          (nameFromId && m.name === nameFromId) ||
          (input.agent_type && m.name === input.agent_type) ||
          (m.agentId && input.agent_id && m.agentId.startsWith(input.agent_id.split('@')[0]))
        );
        if (member && member.prompt) {
          agentDetailName = member.name || agentDetailName;
          const matchedCardId = extractCardId(member.prompt); // FRW-BL-073: shared multi-segment matcher
          if (matchedCardId) cardId = matchedCardId;
          const personaMatch = member.prompt.match(/personaId[:\s]+["']?([a-z0-9-]+)["']?/i);
          if (personaMatch) personaId = personaMatch[1];
          break;
        }
      }
    } catch (e) { /* ignore */ }

    const agentType = input.agent_type || 'developer';
    const inferredType = agentType.includes('architect') ? 'architect' : agentType.includes('review') ? 'review' : agentType.includes('qa') ? 'qa-engineer' : 'developer';

    // Try with full metadata first, fall back without personaId/cardId if FK fails
    let agent = await apiPost('/api/agents', {
      projectId: PROJECT_ID,
      type: inferredType,
      model: normalizedModel || 'sonnet-4',
      ...(cardId ? { cardId } : {}),
      ...(personaId ? { personaId } : {}),
      detail: agentDetailName,
    });
    if (!agent && (cardId || personaId)) {
      // FK constraint likely failed — retry without optional refs
      agent = await apiPost('/api/agents', {
        projectId: PROJECT_ID,
        type: inferredType,
        model: normalizedModel || 'sonnet-4',
        detail: agentDetailName,
      });
    }

    if (agent) {
      // Log spawn event so it shows in the dashboard feed.
      // FRW-BL-094: carry the attribution the row has — an unattributed event is invisible to
      // anything that filters the stream by cardId, and to the computed liveness signal.
      await apiPost('/api/events', {
        projectId: PROJECT_ID,
        type: 'agent_spawned',
        agentId: agent.id,
        ...(agent.cardId ? { cardId: agent.cardId } : {}),
        detail: `${agent.type} spawned: ${agentDetailName}`,
      });

      // Record token data. FRW-BL-095: NOT terminal status — this hook repeats per idle/wake
      // cycle here exactly as it does on the mapped path above, so "late-registered" does not
      // mean "finished". Same reasoning, same fix: session-end owns the terminal write.
      await apiPatch(`/api/agents/${agent.id}`, {
        promptTokens: tokenData.inputTokens,
        completionTokens: tokenData.completionTokens,
        cacheCreationTokens: tokenData.cacheCreationTokens,
        cacheReadTokens: tokenData.cacheReadTokens,
        model: normalizedModel || agent.model,
      });
      dashboardAgentId = agent.id;
      log.info('late_agent_registered', `Late-registered ${agent.type} as ${agent.id} with ${totalTokens} tokens`, { agentId: agent.id });
    }
  }

  // Use the dashboard agent's detail (set by agent-start with rich description) if available
  const dashboardDetail = (existing && existing.detail) || null;
  const agentLabel = dashboardDetail || input.agent_type || input.agent_id || 'subagent';

  // FRW-BL-033: capture the subagent's FINAL assistant message straight from the hook
  // stdin (no transcript parse). The field name is doc-silent for SubagentStop, so read
  // both documented candidate names defensively; absent at runtime → graceful no-op.
  const finalMsgRaw = (typeof input.assistant_message === 'string' && input.assistant_message)
    || (typeof input.last_assistant_message === 'string' && input.last_assistant_message)
    || '';
  const finalMsg = finalMsgRaw ? String(finalMsgRaw).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (finalMsg) {
    log.info('agent_final_message', `Final message (${input.agent_id || 'agent'}): ${finalMsg}`, { agentId: input.agent_id });
  }

  // FRW-BL-095: this fires once per idle/wake CYCLE, so it was never "agent_completed" — one
  // agent routinely produced several, and each republished the CUMULATIVE token total. Anything
  // summing cost from the event stream therefore double-counted (one observed agent reported
  // 1 286 962 then 1 615 166, where the marginal spend of the second cycle was ~329k). The ROW was
  // right all along; the EVENTS were wrong.
  //
  // It is now `agent_yielded`, which is what actually happened, and it carries:
  //   - agentId, so it feeds the API's computed liveness signal (FRW-BL-063 reads the agent's
  //     newest event timestamp). Without it, a working agent looked idle between turns.
  //   - MARGINAL tokens for this cycle, not the running total, so summing the stream is correct.
  // The single terminal `agent_completed` per lifetime is emitted by session-end.js.
  const marginalTokens = tokenData
    ? (tokenData.inputTokens || 0) + (tokenData.completionTokens || 0)
    : 0;
  const eventResult = await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'agent_yielded',
    ...(dashboardAgentId ? { agentId: dashboardAgentId } : {}),
    detail: `${agentLabel} yielded${marginalTokens ? ` (+${marginalTokens.toLocaleString()} tokens this turn)` : ''}${finalMsg ? ` — “${finalMsg.slice(0, 140)}”` : ''}`,
  });
  if (!eventResult) {
    log.warn('event_post_failed', 'Failed to log agent_yielded event');
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

module.exports = { buildStopPatch, normalizeModel, parseTranscriptTokens };

if (require.main === module) {
  main().catch((e) => {
    log.error('unhandled_error', e.message, { error: e.stack });
  });
}
