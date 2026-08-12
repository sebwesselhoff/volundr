// steering-rules.mjs — pure text transforms for constraints.md § Steering Rules (FRW-BL-102).
//
// WHY THIS IS CODE AND NOT A DOCUMENTED CONVENTION. Steering rules are written by Volundr, not by
// the framework: a card scoring below 5.0 appends a rule, a retry scoring >= 8.0 may auto-suppress
// one, and the operator can suppress manually. All three mutated constraints.md in place with NO
// record of what changed, when, which card caused it, or why it was suppressed — while that file is
// injected into EVERY agent prompt. A rule silently appearing or disappearing changes behaviour
// project-wide with no way to correlate the change to an outcome, which is exactly the correlation
// the failure-driven learning loop exists to produce.
//
// Asking the lead to remember a log format is the weak pattern FRW-BL-084 criticised in the
// 529-fallback guidance and FRW-BL-091 rejected for the push receipt. So the format is a mechanism.
//
// Pure over source strings (no fs, no clock) so it is directly testable and deterministic — the
// same shape as garden-lint's pinDrift and loop-controller's decision helpers. `now` is injected
// by the caller for the same reason.
//
// Observed format drift this fixes: system-instructions documents
//   - [CARD-XX-NNN] {rule text} (score: {N.N}, failed: {dimension})
// while a real project (co-azure-audit) uses `- **SR-001:** ...`. Both are accepted on READ;
// writes emit the documented form.

const RULES_HEADING = '## Steering Rules';
const LOG_HEADING = '### Change Log';
const SUPPRESSED = '[SUPPRESSED]';

/** Split source into { before, rulesBody, after } around the ## Steering Rules section. */
function splitSection(src) {
  const lines = String(src ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === RULES_HEADING);
  if (start < 0) return null;
  // The section runs until the next `## ` heading (a `### ` subheading stays inside it).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && !/^###\s+/.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start + 1, end);
  // Change-log entries live INSIDE this section and also begin with "- ", so a naive bullet scan
  // treats them as rules. Caught by this module's own tests: suppressRule would have prefixed
  // [SUPPRESSED] onto a LOG ENTRY whose text happened to contain the card id. Every rule read or
  // write must therefore be bounded to the lines ABOVE the Change Log subheading.
  const logIdx = body.findIndex((l) => l.trim() === LOG_HEADING);
  return {
    before: lines.slice(0, start + 1),
    body,
    after: lines.slice(end),
    rulesEnd: logIdx < 0 ? body.length : logIdx,
  };
}

/**
 * Parse the rules in a constraints.md. Accepts both the documented `- [CARD-ID] text` form and
 * the `- **SR-001:** text` form found in real projects. Suppressed rules are reported, not hidden —
 * the caller decides whether to inject them (session-start skips them for the HOT tier).
 */
export function parseRules(src) {
  const s = splitSection(src);
  if (!s) return [];
  const out = [];
  for (const line of s.body.slice(0, s.rulesEnd)) {
    const t = line.trim();
    if (!t.startsWith('- ')) continue;
    const text = t.slice(2).trim();
    const suppressed = text.startsWith(SUPPRESSED);
    const bare = suppressed ? text.slice(SUPPRESSED.length).trim() : text;
    const cardMatch = bare.match(/^\[([A-Z][A-Z0-9-]*)\]/);
    const srMatch = bare.match(/^\*\*(SR-\d+)[:*]/);
    out.push({
      text: bare,
      suppressed,
      cardId: cardMatch ? cardMatch[1] : null,
      id: srMatch ? srMatch[1] : (cardMatch ? cardMatch[1] : null),
    });
  }
  return out;
}

/** Render one change-log entry line. */
function logLine({ now, action, detail }) {
  return `- ${now} — **${action}** — ${detail}`;
}

/**
 * Insert a change-log entry, creating the `### Change Log` subsection if absent.
 * PREPENDED within the log so the most recent change is visible without scrolling past the rules.
 */
function withLogEntry(s, entry) {
  const body = [...s.body];
  const logIdx = body.findIndex((l) => l.trim() === LOG_HEADING);
  if (logIdx < 0) {
    // Create the subsection at the END of the section, so rules stay directly under the heading
    // where every reader (and the HOT-tier loader) expects them.
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    body.push('', LOG_HEADING, '', entry);
  } else {
    let insertAt = logIdx + 1;
    while (insertAt < body.length && body[insertAt].trim() === '') insertAt++;
    body.splice(insertAt, 0, entry);
  }
  return body;
}

/**
 * Append a steering rule AND its change-log entry in one transform.
 * Returns { content, entry, rule } or throws when there is no Steering Rules section to write to —
 * failing loudly beats silently writing a rule where nothing will read it.
 */
export function addRule(src, { cardId, text, score = null, dimension = null, now }) {
  if (!cardId) throw new Error('addRule: cardId is required — an unattributable rule cannot be correlated to an outcome');
  if (!text || !String(text).trim()) throw new Error('addRule: rule text is required');
  if (!now) throw new Error('addRule: now is required (injected for determinism)');
  const s = splitSection(src);
  if (!s) throw new Error(`addRule: no "${RULES_HEADING}" section found in constraints.md`);

  const scorePart = score != null ? ` (score: ${Number(score).toFixed(1)}${dimension ? `, failed: ${dimension}` : ''})` : '';
  const rule = `- [${cardId}] ${String(text).trim()}${scorePart}`;

  // Place the rule directly under the heading, before any Change Log subsection.
  const body = [...s.body];
  const logIdx = body.findIndex((l) => l.trim() === LOG_HEADING);
  const placeholderIdx = body.findIndex((l) => /^\(none yet/i.test(l.trim()));
  if (placeholderIdx >= 0) {
    body.splice(placeholderIdx, 1, rule);
  } else {
    let at = logIdx >= 0 ? logIdx : body.length;
    while (at > 0 && body[at - 1].trim() === '') at--;
    body.splice(at, 0, rule);
  }

  const entry = logLine({
    now,
    action: 'added',
    detail: `[${cardId}]${score != null ? ` scored ${Number(score).toFixed(1)}` : ''}${dimension ? `, failed ${dimension}` : ''} → ${String(text).trim()}`,
  });
  const withLog = withLogEntry({ ...s, body }, entry);
  return { content: [...s.before, ...withLog, ...s.after].join('\n'), entry, rule };
}

/**
 * Suppress a rule by prefixing [SUPPRESSED] and logging why.
 * `match` is a substring or the card id. `auto` records that the >= 8.0 retry path fired rather
 * than a human — that distinction is the whole point of logging suppressions.
 */
export function suppressRule(src, { match, reason, now, auto = false }) {
  if (!match) throw new Error('suppressRule: match is required');
  if (!reason || !String(reason).trim()) throw new Error('suppressRule: reason is required — an unexplained suppression is what this card exists to stop');
  if (!now) throw new Error('suppressRule: now is required (injected for determinism)');
  const s = splitSection(src);
  if (!s) throw new Error(`suppressRule: no "${RULES_HEADING}" section found`);

  const body = [...s.body];
  let hit = -1;
  // Bounded to s.rulesEnd so a change-log entry mentioning the same card id is never mistaken
  // for the rule itself.
  for (let i = 0; i < s.rulesEnd; i++) {
    const t = body[i].trim();
    if (!t.startsWith('- ')) continue;
    if (t.includes(SUPPRESSED)) continue; // already suppressed — idempotent
    if (t.includes(match)) { hit = i; break; }
  }
  if (hit < 0) return { content: String(src), entry: null, suppressed: false };

  const original = body[hit].trim().slice(2).trim();
  const indent = body[hit].slice(0, body[hit].indexOf('- '));
  body[hit] = `${indent}- ${SUPPRESSED} ${original}`;

  const entry = logLine({
    now,
    action: auto ? 'auto-suppressed' : 'suppressed',
    detail: `${original.slice(0, 120)} — ${String(reason).trim()}`,
  });
  const withLog = withLogEntry({ ...s, body }, entry);
  return { content: [...s.before, ...withLog, ...s.after].join('\n'), entry, suppressed: true };
}

export const HEADINGS = { RULES_HEADING, LOG_HEADING, SUPPRESSED };
