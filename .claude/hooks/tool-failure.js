// PostToolUseFailure hook - log tool failures to dashboard for observability
// Fires when any tool call fails (non-zero exit, timeout, error)
// Non-blocking: purely observational

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');

const log = createLogger('tool-failure');

async function main() {
  const input = readStdin();
  if (!PROJECT_ID) return;

  const toolName = input.tool_name || 'unknown';
  const error = (input.error || '').slice(0, 200);
  const isInterrupt = input.is_interrupt || false;

  // Skip logging for interrupts (user cancelled) - not real failures
  if (isInterrupt) return;

  // Skip transient errors that are normal agent workflow - not real failures:
  // - File too large for Read tool (agents will chunk-read or skip)
  // - File not found during exploration (agents try multiple paths)
  // - Build exit code 1 (normal TDD: test fails before implementation)
  // - Exit code 2 from grep/find (no matches found)
  const transientPatterns = [
    /exceeds maximum allowed tokens/i,
    /File does not exist/i,
    /Exit code [12]\b/,
    /No files found/i,
    /not found; run without arguments/i,
    /Cannot POST/i,
  ];

  const isTransient = transientPatterns.some(p => p.test(error));
  if (isTransient) {
    log.debug('tool_failed_transient', `${toolName}: ${error}`, {
      agentId: input.agent_id || null,
    });
    return; // Don't pollute the dashboard
  }

  log.warn('tool_failed', `${toolName} failed: ${error}`, {
    agentId: input.agent_id || null,
  });

  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'error',
    detail: `Tool failure: ${toolName} - ${error}`.slice(0, 200),
  });
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
