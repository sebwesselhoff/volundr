// Shared cardId extraction — used by pre-agent-tool.js and agent-start.js.
//
// WHY a shared module: both hooks must use the IDENTICAL regex so the pattern
// cannot silently drift between them (a past ISC concern).
//
// Pattern rationale (FRW-BL-071):
//   /\b(?:CARD-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\b/
//
//   (?:CARD-)?          — optional literal "CARD-" prefix (old single-segment style)
//   [A-Z][A-Z0-9]*      — first segment: starts with a letter (e.g. "FRW", "BE", "CLR")
//   (?:-[A-Z0-9]+)*     — zero or more additional alpha-numeric segments (e.g. "-BL", "-FE")
//   -\d{3}              — mandatory 3-digit suffix (e.g. "-071", "-001")
//   \b                  — word boundary (prevents partial matches inside longer tokens)
//
// Matches:  FRW-BL-071, CLR-FE-001, CO-AZ-012, CARD-BE-003, BE-003, CARD-XX-123
// No-match: "background color", "v5", "I think 100", "123-456"

const CARD_ID_RE = /\b(?:CARD-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\b/;

/**
 * Extract the first card id from `text`.
 * Returns the matched string (e.g. "FRW-BL-071") or null if none found.
 * @param {string} text
 * @returns {string|null}
 */
function extractCardId(text) {
  if (!text) return null;
  const m = String(text).match(CARD_ID_RE);
  return m ? m[0] : null;
}

module.exports = { extractCardId, CARD_ID_RE };
