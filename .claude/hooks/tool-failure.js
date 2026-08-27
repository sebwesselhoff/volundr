// PostToolUseFailure hook - log tool failures to dashboard for observability
// Fires when any tool call fails (non-zero exit, timeout, error)
// Non-blocking: purely observational

const { apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { resolveAgentId } = require('./vldr-agent-resolve');

const log = createLogger('tool-failure');

// Valid effort levels as documented for PostToolUseFailure stdin (input.effort?.level).
// Using stdin field is canonical; the env-var name for effort is uncertain.
const VALID_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Emit a tool_telemetry event to the dashboard (additive, non-blocking).
// duration_ms: CONFIRMED live (this session) that CC populates input.duration_ms +
// input.effort.level in PostToolUse stdin (observed on real commands). Still read
// defensively (null-guard + Number.isFinite) and only include when finite, so the
// hook stays correct if a future CC build omits the field on the failure event.
async function emitTelemetry(input) {
  try {
    if (!PROJECT_ID) return;

    const toolName = input.tool_name || 'unknown';

    // duration_ms: doc-silent — may be undefined; only use when finite
    const d = Number(input.duration_ms);
    const durOk = input.duration_ms != null && Number.isFinite(d); // null/undefined → omit (avoid Number(null)===0)

    // effort.level: validate against known enum; fall back to 'unknown'
    const rawLevel = input.effort?.level;
    const effortLevel = VALID_EFFORT_LEVELS.has(rawLevel) ? rawLevel : 'unknown';

    const sessionId = input.session_id || null;

    // Build detail string: omit duration segment when not finite
    const durPart = durOk ? ` ${d}ms` : '';
    const detail = `${toolName}${durPart} effort=${effortLevel}`;

    // FRW-BL-116: same attribution as the PostToolUse emitter — a failing tool call is still
    // activity, and a turn that fails repeatedly is exactly when an agent most looks dead. Shared
    // resolver rather than a second copy: agent_id before session_id, because a subagent's payload
    // carries the PARENT's session_id. Unresolvable ⇒ field omitted, as before.
    const agentId = resolveAgentId(input);

    // FRW-BL-116 ISC-5: tool_name/effort_level/duration_ms/session_id were silently discarded by
    // POST /api/events (it destructures only projectId, cardId, agentId, type, detail, costEstimate
    // and the table has no columns for them). Stopped sending rather than adding columns — `detail`
    // already carries tool, duration and effort in parseable form. Same decision as post-bash-git.js;
    // if structured columns are ever added, re-add these fields in the same change.
    const payload = {
      projectId: PROJECT_ID,
      type: 'tool_telemetry',
      detail,
    };
    if (agentId) payload.agentId = agentId;

    await apiPost('/api/events', payload);
    log.info('tool_telemetry', detail, agentId ? { agentId } : {});
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

  // FRW-BL-088: classify the failure and surface a degradation recommendation.
  //
  // Native `fallbackModel` (settings.json) covers the OVERLOAD class only — the platform never
  // switches models on rate-limit (429), request-size, auth/billing or transport errors. Those
  // classes are exactly what budget-controller's classifyError/nextFallback handle, which is why
  // they were kept rather than deleted when native fallback was declared (FRW-BL-084).
  //
  // This hook is the one JS error path that sees every tool failure, so it is where the
  // classification becomes observable. The hook OBSERVES and RECOMMENDS; Volundr (reading the
  // event stream) decides — matching the framework's split between JS hooks and the model loop.
  const degradation = await classifyFailure(error);

  log.warn('tool_failed', `${toolName} failed: ${error}`, {
    agentId: input.agent_id || null,
    errorClass: degradation ? degradation.errorClass : null,
  });

  const classSuffix = degradation ? ` [${degradation.errorClass}]` : '';
  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'error',
    detail: `Tool failure: ${toolName} - ${error}${classSuffix}`.slice(0, 200),
    ...(degradation && {
      error_class: degradation.errorClass,
      retryable: degradation.retry,
      recommended_tier: degradation.tier,
      degradation_reason: degradation.reason,
    }),
  });
}

/**
 * Classify a failure string and derive a fallback recommendation.
 *
 * budget-controller is ESM and this hook is CommonJS, so it is loaded via dynamic import().
 * Returns null on any problem — a classification failure must never change the hook's behaviour,
 * which is purely observational.
 */
async function classifyFailure(errorText) {
  try {
    if (!errorText) return null;
    const { pathToFileURL } = require('url');
    const modPath = require('path').join(__dirname, '..', '..', 'scripts', 'budget-controller.mjs');
    if (!require('fs').existsSync(modPath)) return null;
    const { classifyError, nextFallback } = await import(pathToFileURL(modPath).href);

    const errorClass = classifyError(errorText);
    // Only the retryable classes carry a useful recommendation; 'fatal' escalates.
    if (errorClass === 'fatal') {
      return { errorClass, retry: false, tier: null, reason: 'non-retryable — escalate' };
    }
    // The current tier is not observable from this hook's stdin, so ask for the recommendation
    // from the top of the ladder; the shape of the advice (retry + step down) is what matters.
    const advice = nextFallback('opus', errorClass);
    return {
      errorClass,
      retry: !!advice.retry,
      tier: advice.tier,
      reason: advice.reason,
    };
  } catch {
    return null;
  }
}

if (require.main === module) {
  main().catch((e) => {
    // GRACEFUL DEGRADE: PostToolUseFailure is purely observational — an unhandled
    // error here must never break the session. Record the bug, then exit 0.
    try { log.error('unhandled_error', e.message, { error: e.stack }); } catch { /* ignore */ }
    process.exit(0);
  });
}
