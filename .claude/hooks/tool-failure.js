// PostToolUseFailure hook - log tool failures to dashboard for observability
// Fires when any tool call fails (non-zero exit, timeout, error)
// Non-blocking: purely observational

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');

const log = createLogger('tool-failure');

// Valid effort levels as documented for PostToolUseFailure stdin (input.effort?.level).
// Using stdin field is canonical; the env-var name for effort is uncertain.
const VALID_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Emit a tool_telemetry event to the dashboard (additive, non-blocking).
// duration_ms is DOC-SILENT for PostToolUseFailure: CC may or may not populate it.
// We read it defensively and only include it when finite.
// TODO(restart-deferred): verify at next real restart whether CC populates
//   input.duration_ms in PostToolUseFailure stdin. In synthetic tests (injected JSON)
//   the value survives as expected.
async function emitTelemetry(input) {
  try {
    if (!PROJECT_ID) return;

    const toolName = input.tool_name || 'unknown';

    // duration_ms: doc-silent — may be undefined; only use when finite
    const d = Number(input.duration_ms);
    const durOk = Number.isFinite(d);

    // effort.level: validate against known enum; fall back to 'unknown'
    const rawLevel = input.effort?.level;
    const effortLevel = VALID_EFFORT_LEVELS.has(rawLevel) ? rawLevel : 'unknown';

    const sessionId = input.session_id || null;

    // Build detail string: omit duration segment when not finite
    const durPart = durOk ? ` ${d}ms` : '';
    const detail = `${toolName}${durPart} effort=${effortLevel}`;

    const payload = {
      projectId: PROJECT_ID,
      type: 'tool_telemetry',
      detail,
      tool_name: toolName,
      effort_level: effortLevel,
    };
    if (durOk) payload.duration_ms = d;
    if (sessionId) payload.session_id = sessionId;

    await apiPost('/api/events', payload);
    log.info('tool_telemetry', detail);
  } catch {
    // Telemetry failure must NOT affect hook exit behaviour
  }
}

async function main() {
  const input = readStdin();

  // Additive telemetry — runs regardless of PROJECT_ID guard below; wrapped in
  // its own try/catch so it can never alter the hook's exit behaviour.
  await emitTelemetry(input);

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

if (require.main === module) {
  main().catch((e) => {
    // GRACEFUL DEGRADE: PostToolUseFailure is purely observational — an unhandled
    // error here must never break the session. Record the bug, then exit 0.
    try { log.error('unhandled_error', e.message, { error: e.stack }); } catch { /* ignore */ }
    process.exit(0);
  });
}
