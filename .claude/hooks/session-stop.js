// Stop hook - session cleanup
// NOTE: The Stop hook fires on intermediate events, not just final session exit.
// We CANNOT reliably distinguish final exit from mid-session stops.
// Therefore: we only log, we do NOT complete agents or clear activeProject.
// Cleanup is handled by session-start.js on next boot (crash recovery pattern).

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

  // DO NOT complete agents here - Stop fires mid-session
  // DO NOT clear activeProject here - Stop fires mid-session
  // session-start.js handles cleanup on next boot via crash recovery
}

main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
