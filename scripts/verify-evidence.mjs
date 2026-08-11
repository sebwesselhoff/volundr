#!/usr/bin/env node
/**
 * verify-evidence.mjs — deterministic ISC evidence validator (FRW-BL-086, Tier 0)
 *
 * WHY THIS EXISTS
 *   framework/quality.md § "Tiered, Statistically-Confident Quality Gate" documents a
 *   "Tier 0 — static, cheap, deterministic" ISC STRUCTURAL check that "runs FIRST, before any LLM
 *   judge" and validates the fresh VERIFY block. No such script existed — the gate was enforced
 *   solely by the cheapest-tier LLM reviewer, budget-capped at a handful of file reads. Documented
 *   guarantees with no implementation are worse than no documentation: they get relied upon.
 *
 * WHAT IT CHECKS
 *   For each ISC criterion whose truth depends on RUNTIME behaviour, its evidence must carry a
 *   VERIFY block (grammar per .claude/skills/vldr-verify/SKILL.md):
 *
 *       VERIFY <command>
 *       exit=<integer>
 *       <output lines proving the claim>
 *       ran: <session id | "this session" | ISO timestamp>
 *
 *   - command present and non-empty
 *   - exit code present and an INTEGER (a claim of success with a non-zero exit is a failure)
 *   - at least one non-empty output line between the exit line and `ran:`
 *   - `ran:` marker present, and — when a current session id is supplied — not naming a DIFFERENT
 *     session (stale evidence copied forward from an earlier run)
 *
 * FAIL-CLOSED
 *   Malformed input, a non-array ISC, a criterion that is not an object, unparseable evidence —
 *   all are ERRORS, never silent passes. The only thing that is ever skipped is a criterion
 *   classified as NOT runtime-dependent, and that classification deliberately errs toward "not"
 *   (see classifyCriterion) so the check never blocks a legitimately static criterion.
 *
 * SCOPE: pure functions, no I/O, no globals — unit-testable in isolation.
 * Self-test: scripts/verify-evidence.test.mjs
 */

/** Phrases that make a criterion's truth depend on something actually RUNNING. */
const RUNTIME_PHRASES = Object.freeze([
  'exits 0', 'exit 0', 'exit code', 'non-zero exit',
  'passes', 'passing', 'fails', 'failing',
  'test suite', 'self-test', 'unit test', 'tests run', 'tests pass',
  'build succeeds', 'build passes', 'compiles', 'typecheck', 'tsc',
  'returns 200', 'responds', 'endpoint returns', 'http 200',
  'no errors', 'zero errors', 'lint clean', 'lint passes',
  'verified by running', 'when run', 'at runtime',
  'ci is green', 'ci passes', 'gate passes',
]);

/**
 * Explicit opt-in/out beats every heuristic.
 *   criterion.requiresRuntime === true  -> runtime
 *   criterion.requiresRuntime === false -> static (never second-guessed)
 *
 * Otherwise fall back to phrase matching. The heuristic ERRS TOWARD "not runtime": a criterion is
 * only treated as runtime-dependent when it clearly describes an observable execution outcome.
 * Rationale: a false positive blocks a legitimate static criterion (bad, and invisible to the
 * author); a false negative merely leaves it to the LLM judge, which is the status quo.
 *
 * @returns {{requiresRuntime: boolean, reason: string}}
 */
export function classifyCriterion(entry) {
  if (!entry || typeof entry !== 'object') {
    return { requiresRuntime: false, reason: 'not an object' };
  }
  if (entry.requiresRuntime === true) return { requiresRuntime: true, reason: 'explicit requiresRuntime:true' };
  if (entry.requiresRuntime === false) return { requiresRuntime: false, reason: 'explicit requiresRuntime:false' };

  const text = String(entry.criterion || '').toLowerCase();
  if (!text) return { requiresRuntime: false, reason: 'empty criterion text' };

  const hit = RUNTIME_PHRASES.find((p) => text.includes(p));
  return hit
    ? { requiresRuntime: true, reason: `matched runtime phrase "${hit}"` }
    : { requiresRuntime: false, reason: 'no runtime phrase matched (heuristic errs toward static)' };
}

/**
 * Parse a VERIFY block out of an evidence string.
 * @returns {{found: boolean, command: string|null, exitCode: number|null, output: string[], ran: string|null}}
 */
export function parseVerifyBlock(evidence) {
  const empty = { found: false, command: null, exitCode: null, output: [], ran: null };
  if (typeof evidence !== 'string' || !evidence.trim()) return empty;

  const lines = evidence.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^\s*`{0,3}\s*VERIFY\b/i.test(l));
  if (startIdx === -1) return empty;

  const commandRaw = lines[startIdx].replace(/^\s*`{0,3}\s*VERIFY\b/i, '').trim();
  const command = commandRaw.replace(/^\[|\]$/g, '').trim() || null;

  let exitCode = null;
  let ran = null;
  const output = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const exitMatch = line.match(/^\s*exit\s*=\s*(-?\d+)\s*$/i);
    if (exitMatch && exitCode === null) {
      exitCode = Number.parseInt(exitMatch[1], 10);
      continue;
    }
    const ranMatch = line.match(/^\s*ran\s*:\s*(.+?)\s*$/i);
    if (ranMatch && ran === null) {
      ran = ranMatch[1].trim();
      continue;
    }
    // A non-integer exit line is NOT output — it is a malformed exit, surfaced by validate().
    if (/^\s*exit\s*=/i.test(line)) continue;
    if (/^\s*`{3,}\s*$/.test(line)) continue; // fence
    if (line.trim()) output.push(line.trim());
  }

  return { found: true, command, exitCode, output, ran };
}

/**
 * Validate one ISC entry. Static criteria are skipped; runtime criteria must carry a valid,
 * fresh VERIFY block whose exit code is 0.
 *
 * @param {object} entry ISC criterion { criterion, passed, evidence, requiresRuntime? }
 * @param {{sessionId?: string}} [opts]
 * @returns {{ok: boolean, skipped: boolean, errors: string[]}}
 */
export function validateEntry(entry, opts = {}) {
  const errors = [];
  const label = entry && entry.criterion ? `"${String(entry.criterion).slice(0, 70)}"` : '<unnamed criterion>';

  if (!entry || typeof entry !== 'object') {
    return { ok: false, skipped: false, errors: [`${label}: ISC entry is not an object`] };
  }

  // Only claims asserted TRUE need proof. An unmet criterion is the done-gate's business
  // (cards.ts / task-completed.js), not this parser's.
  if (entry.passed !== true) return { ok: true, skipped: true, errors: [] };

  const { requiresRuntime } = classifyCriterion(entry);
  if (!requiresRuntime) return { ok: true, skipped: true, errors: [] };

  const block = parseVerifyBlock(entry.evidence);
  if (!block.found) {
    return {
      ok: false,
      skipped: false,
      errors: [`${label}: runtime-verifiable criterion marked passed:true but its evidence has no VERIFY block`],
    };
  }

  if (!block.command) errors.push(`${label}: VERIFY block has no command`);
  if (block.exitCode === null) errors.push(`${label}: VERIFY block has no integer exit= line`);
  else if (block.exitCode !== 0) errors.push(`${label}: claimed passed:true but VERIFY exit=${block.exitCode}`);
  if (block.output.length === 0) errors.push(`${label}: VERIFY block has no output proving the claim`);

  if (!block.ran) {
    errors.push(`${label}: VERIFY block has no "ran:" freshness marker`);
  } else if (opts.sessionId) {
    // A `ran:` naming some OTHER session id is evidence copied forward from an earlier run.
    const ids = block.ran.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
    if (ids.length > 0 && !ids.some((id) => id.toLowerCase() === String(opts.sessionId).toLowerCase())) {
      errors.push(`${label}: STALE evidence — VERIFY ran in session ${ids[0]}, current session is ${opts.sessionId}`);
    }
  }

  return { ok: errors.length === 0, skipped: false, errors };
}

/**
 * Validate a whole ISC array.
 * @returns {{ok: boolean, checked: number, skipped: number, errors: string[]}}
 */
export function validateIsc(isc, opts = {}) {
  if (isc === null || isc === undefined) {
    // Null/empty ISC is exempt for backward compatibility (matches the API's own gate).
    return { ok: true, checked: 0, skipped: 0, errors: [] };
  }
  if (!Array.isArray(isc)) {
    return { ok: false, checked: 0, skipped: 0, errors: ['ISC is not an array — cannot validate (failing closed)'] };
  }

  const errors = [];
  let checked = 0;
  let skipped = 0;
  for (const entry of isc) {
    const r = validateEntry(entry, opts);
    if (r.skipped) skipped++;
    else checked++;
    errors.push(...r.errors);
  }
  return { ok: errors.length === 0, checked, skipped, errors };
}
