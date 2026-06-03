// Stop hook - session cleanup
// NOTE: The Stop hook fires on intermediate events, not just final session exit.
// We CANNOT reliably distinguish final exit from mid-session stops.
// Therefore: we only log, we do NOT complete agents or clear activeProject.
// Cleanup is handled by session-start.js on next boot (crash recovery pattern).
//
// CONTRACT (FRW-BL-028) — this is a Stop hook and MUST NOT block-retry.
// Claude Code caps a Stop/SubagentStop hook at 8 *consecutive blocks* before it
// force-ends the turn with a warning (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, default 8,
// since v2.1.143). A "block" is `process.exit(2)` OR stdout `{"decision":"block"}`.
// (There is NO documented `{"continue":false,"stopReason":...}` form — do not use it.)
// This hook therefore exits 0 only. If a future change needs to keep the agent
// working, do it on a NON-Stop event (TeammateIdle / PreToolUse), never here —
// otherwise a retry loop will silently truncate at the cap.

const { readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('session-stop');

async function main() {
  const input = readStdin();

  // Only handle lead/standalone sessions - teammates are tracked by SubagentStop
  if (input.team_name && input.teammate_name) return;

  // Only act on real session stops (not subagent/background stops)
  if (!input.session_id) return;

  log.info('stop_event', `Stop event received for session ${(input.session_id || '').slice(0, 12)}`, {
    agentId: null,
  });

  // FRW-BL-033: capture the lead's FINAL assistant message from stdin (no transcript
  // parse). Doc-silent field name → read both documented candidates defensively; absent
  // → no-op. Logged only (Stop fires mid-session, so do NOT spam the dashboard event feed).
  const finalMsgRaw = (typeof input.assistant_message === 'string' && input.assistant_message)
    || (typeof input.last_assistant_message === 'string' && input.last_assistant_message)
    || '';
  if (finalMsgRaw) {
    log.info('session_final_message', `Final message: ${String(finalMsgRaw).replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }

  // DO NOT complete agents here - Stop fires mid-session
  // DO NOT clear activeProject here - Stop fires mid-session
  // session-start.js handles cleanup on next boot via crash recovery
}

if (require.main === module) {
  main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
}
