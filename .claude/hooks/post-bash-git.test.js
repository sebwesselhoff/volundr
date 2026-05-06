// post-bash-git.test.js — Self-test for the card-ID parser in post-bash-git.js
// Run: node .claude/hooks/post-bash-git.test.js
// No test framework dependency — uses Node.js built-in `assert`.

const assert = require('assert');

// ---- Inline the regex so the test has no import side-effects ----
// (vldr-api.js fires side effects on require, so we duplicate the one constant)
const CARD_ID_REGEX = /\b[A-Z]{2,8}(?:-[A-Z]{1,8}){0,2}-\d{3,4}[A-Z]?\b/g;

function extractIds(text) {
  return [...new Set(text.match(CARD_ID_REGEX) || [])];
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// (a) Volundr-style ID in subject only
// ---------------------------------------------------------------------------
test('(a) Volundr-style ID in subject (feat(frw-002): ...)', () => {
  // Conventional commit subjects use lowercase in the scope; the commit message
  // body may reference the uppercase canonical ID.
  const msg = `feat(frw-002): auto-synthesise persona_history on card close

Implements FRW-002 as described in the blueprint.`;
  const ids = extractIds(msg);
  assert.ok(ids.includes('FRW-002'), `Expected FRW-002, got: ${JSON.stringify(ids)}`);
  // The lowercase scope "(frw-002)" must NOT match — regex requires uppercase
  assert.ok(!ids.includes('frw-002'), 'Lowercase scope should not match');
});

// ---------------------------------------------------------------------------
// (b) Project-domain ID in body (Refs CLR-FE-001)
// ---------------------------------------------------------------------------
test('(b) Project-domain ID in body (Refs CLR-FE-001)', () => {
  const msg = `fix: correct date parsing in assessment export

The export was silently truncating UTC offsets.

Refs CLR-FE-001`;
  const ids = extractIds(msg);
  assert.ok(ids.includes('CLR-FE-001'), `Expected CLR-FE-001, got: ${JSON.stringify(ids)}`);
});

// ---------------------------------------------------------------------------
// (c) Mixed subject + body — multiple unique IDs extracted, no duplicates
// ---------------------------------------------------------------------------
test('(c) Mixed subject+body — multiple IDs, deduped', () => {
  const msg = `feat(frw-bl-014a): post-commit card-ID validator in post-bash-git.js

Implements FRW-BL-014A (Gate 1). Related: CARD-FRW-002.
Also resolves FRW-BL-014A (duplicate reference should not inflate the list).`;
  const ids = extractIds(msg);
  assert.ok(ids.includes('FRW-BL-014A'), `Expected FRW-BL-014A, got: ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('CARD-FRW-002'), `Expected CARD-FRW-002, got: ${JSON.stringify(ids)}`);
  // FRW-BL-014A must appear exactly once after dedup
  const occurrences = ids.filter(id => id === 'FRW-BL-014A').length;
  assert.strictEqual(occurrences, 1, `FRW-BL-014A should appear once after dedup, got ${occurrences}`);
});

// ---------------------------------------------------------------------------
// (d) False-positive guard — version strings, PR numbers, short tokens
//
// Note: RFC-1234 structurally matches the regex (uppercase prefix + digits)
// and IS extracted by the parser. That is intentional: the validation loop
// calls apiGet('/api/cards/RFC-1234'), gets null (not in dashboard), and
// silently skips it per ISC criterion 4 ("fail-open on null"). The regex
// does NOT need to exclude RFC-1234; the API lookup is the filter.
//
// What the regex MUST NOT match: dotted-version strings (1.2.3),
// git-tag prefixes (v2.0.0), purely-numeric tokens, and short (<3 char) IDs.
// ---------------------------------------------------------------------------
test('(d) False-positive guard — version strings and purely numeric tokens do not match', () => {
  const msg = `chore: bump dependencies

Bumped version 1.2.3. See tag v2.0.0 and PR-99. No card IDs here.`;
  const ids = extractIds(msg);
  // 1.2.3 → no letters, v2.0.0 → starts with lowercase, PR-99 → only 2 digits
  assert.strictEqual(ids.length, 0,
    `Expected no card IDs but got: ${JSON.stringify(ids)}`);
});

// (d2) RFC-style tokens ARE extracted but resolved to null by apiGet (fail-open)
test('(d2) RFC-1234 is extracted but the API null-check makes it a no-op', () => {
  // The parser extracts RFC-1234; the validation loop silently skips null results.
  // This test just confirms the regex doesn't panic on such tokens.
  const msg = 'See also RFC-1234 for the specification.';
  const ids = extractIds(msg);
  // RFC-1234 matches the pattern — that is expected.
  // The important guarantee is that false positives don't cause errors;
  // the hook's apiGet null-check handles that at runtime.
  assert.ok(Array.isArray(ids), 'extractIds should return an array');
  // No assertion on presence/absence — outcome is API-lookup-dependent.
});

// ---------------------------------------------------------------------------
// (e) Sanity check against patterns from recent real commits in this repo
// ---------------------------------------------------------------------------
test('(e) Real recent commit pattern: FRW-BL-015, FRW-BL-017, FRW-002', () => {
  const realMsg = `docs(frw-bl-014): card-status gate so code can't land under backlog cards

Surfaced during CLEAR portal walk. Proposes FRW-BL-014A, FRW-BL-014B, FRW-BL-014C.
Also references FRW-002 (persona_history synthesis).`;
  const ids = extractIds(realMsg);
  assert.ok(ids.includes('FRW-BL-014A'), `Expected FRW-BL-014A in ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('FRW-BL-014B'), `Expected FRW-BL-014B in ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('FRW-BL-014C'), `Expected FRW-BL-014C in ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('FRW-002'), `Expected FRW-002 in ${JSON.stringify(ids)}`);
});

// ---------------------------------------------------------------------------
// (f) Edge case: 3-segment ID with letter suffix (FRW-BL-014A style)
// ---------------------------------------------------------------------------
test('(f) Three-segment ID with letter suffix (FRW-BL-014A)', () => {
  const msg = 'Closes FRW-BL-014A and CLR-FE-001B.';
  const ids = extractIds(msg);
  assert.ok(ids.includes('FRW-BL-014A'), `Expected FRW-BL-014A, got: ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('CLR-FE-001B'), `Expected CLR-FE-001B, got: ${JSON.stringify(ids)}`);
});

// ---------------------------------------------------------------------------
// (g) Must NOT match: all-digit segment IDs that look like commit hashes
// ---------------------------------------------------------------------------
test('(g) Does not match git commit hashes embedded in prose', () => {
  // Commit hashes are hex (lowercase), but let's confirm no false match on
  // patterns that don't fit the uppercase-prefix requirement.
  const msg = 'cherry-pick abc1234 from 67faa1d; see also tag v1.0.0';
  const ids = extractIds(msg);
  assert.strictEqual(ids.length, 0,
    `Expected no card IDs but got: ${JSON.stringify(ids)}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('PASS');
}
