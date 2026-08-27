// vldr-agent-resolve.js — resolve the dashboard agent row that a hook payload belongs to.
//
// FRW-BL-116. The dashboard's liveness signal (FRW-BL-063) computes each agent's last activity as
// `max(events.timestamp)` GROUPED BY `events.agent_id`, then buckets it: newer than 30s = working,
// older than 5min = stalled. `tool_telemetry` (FRW-BL-038) is the one event that fires every few
// seconds — and it was written with `agentId` unset, so it contributed nothing. The signal read
// exclusively from lifecycle events, which fire only at turn boundaries. Measured consequence: the
// Volundr lead read `liveness=stalled` while it was the only thing driving the session.
//
// THE ORDER OF THESE TWO CHECKS IS THE WHOLE POINT, and it is established by a captured payload
// rather than assumed. A real PostToolUse from inside a subagent was probed on 2026-08-27:
//
//   lead     → { session_id: 'd0df4de6-…', agent_id: null,                          agent_type: null }
//   subagent → { session_id: 'd0df4de6-…', agent_id: 'areviewer-frw-bl-114-3214a8…', agent_type: 'reviewer-frw-bl-114' }
//
// A subagent's payload carries the PARENT's session_id — three different subagents all reported the
// lead's session id, one distinct value across the whole capture. So resolving by session_id FIRST
// would attribute every subagent's tool calls to the lead: the lead's liveness would look fixed
// (for the wrong reason) and every subagent would stay exactly as broken. `agent_id` must win, and
// its absence is what identifies the lead.
//
// Both lookup tables already exist and are written by agent-start.js / the boot sequence, so this
// adds no new state to keep in sync:
//   os.tmpdir()/mc-agent-map/<agent_id>            → dashboard agent id   (subagent)
//   os.tmpdir()/mc-agent-map/session-<session_id>  → dashboard agent id   (lead)
//
// FAILS SAFE, by project constraint: any unresolvable payload returns null and the caller simply
// omits `agentId`, which is exactly today's behaviour. Telemetry must never become a hard
// dependency on attribution — a hook error must not break the parent turn.

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * PURE. Decide which map key identifies the agent behind a hook payload.
 * Injected/derived nothing — testable without a filesystem.
 *
 * @param {object} input - raw hook stdin payload
 * @returns {{kind: 'subagent'|'lead', key: string} | null}
 */
function pickMapKey(input) {
  if (!input || typeof input !== 'object') return null;

  // Subagent FIRST — see the header. agent_id is present only for subagents.
  const agentId = input.agent_id;
  if (typeof agentId === 'string' && agentId.trim()) {
    return { kind: 'subagent', key: agentId.trim() };
  }

  // No agent_id ⇒ the lead. Its row is keyed by session.
  const sessionId = input.session_id;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    return { kind: 'lead', key: `session-${sessionId.trim()}` };
  }

  return null;
}

/** Directory holding the agent-id → dashboard-id map files. Read-only here; agent-start owns writes. */
function getMapDir() {
  return path.join(os.tmpdir(), 'mc-agent-map');
}

/**
 * Resolve the dashboard agent row id for a hook payload, or null.
 * Never throws.
 *
 * @param {object} input - raw hook stdin payload
 * @param {{mapDir?: string}} [opts] - mapDir injectable for tests
 * @returns {string | null}
 */
function resolveAgentId(input, opts = {}) {
  try {
    const picked = pickMapKey(input);
    if (!picked) return null;

    const dir = opts.mapDir || getMapDir();
    // Guard against a key that would escape the map directory. The key is derived from hook stdin,
    // so treat it as untrusted even though it is machine-generated.
    if (picked.key.includes('/') || picked.key.includes('\\') || picked.key.includes('..')) {
      return null;
    }

    const file = path.join(dir, picked.key);
    const value = fs.readFileSync(file, 'utf8').trim();
    return value || null;
  } catch {
    // Missing map file is the normal case for an unregistered agent — not an error worth surfacing.
    return null;
  }
}

module.exports = { pickMapKey, resolveAgentId, getMapDir };
