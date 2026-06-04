// Self-test for _cardid.js (FRW-BL-071): multi-segment cardId extraction.
//
// Verifies that both hooks use the shared extractCardId() function and that
// the regex correctly matches multi-segment IDs (FRW-BL-NNN, CLR-FE-NNN, etc.)
// as well as the legacy single-segment CARD-XX-NNN form, with no false positives.
//
// Run: node cardid.test.js  — exits 0 on success, 1 on any failure.

const { extractCardId } = require('./_cardid');

// Verify the hooks import the shared module (pattern-drift guard).
// If either require fails, the test crashes — which is itself a test failure.
const preAgentToolSrc = require('fs').readFileSync(require('path').join(__dirname, 'pre-agent-tool.js'), 'utf8');
const agentStartSrc = require('fs').readFileSync(require('path').join(__dirname, 'agent-start.js'), 'utf8');

let pass = 0;
let fail = 0;

function ok(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}
function eq(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('_cardid.js self-test (FRW-BL-071)\n');

// ---------------------------------------------------------------------------
// 1. HOOKS IMPORT THE SHARED MODULE (pattern-drift guard)
// ---------------------------------------------------------------------------
console.log('1. Hook import check');
ok('pre-agent-tool.js requires ./_cardid', preAgentToolSrc.includes("require('./_cardid')"));
ok('pre-agent-tool.js calls extractCardId', preAgentToolSrc.includes('extractCardId('));
ok('agent-start.js requires ./_cardid', agentStartSrc.includes("require('./_cardid')"));
ok('agent-start.js calls extractCardId', agentStartSrc.includes('extractCardId('));
// Confirm neither hook contains the old hardcoded regex pattern
ok('pre-agent-tool.js does NOT contain old regex', !preAgentToolSrc.includes('CARD-[A-Z0-9]+-\\d{3}'));
ok('agent-start.js does NOT contain old regex', !agentStartSrc.includes('CARD-[A-Z0-9]+-\\d{3}'));

// ---------------------------------------------------------------------------
// 2. POSITIVE — multi-segment IDs extracted correctly from realistic prompts
// ---------------------------------------------------------------------------
console.log('\n2. Positive: multi-segment and CARD-prefixed IDs');

// Format: "# FRW-BL-069: title" (no CARD- prefix, ISC style)
eq('FRW-BL-069 from "# FRW-BL-069: title\\n..."',
  extractCardId('# FRW-BL-069: Fix something\npersonaId: dev-01'),
  'FRW-BL-069');

// Same id via CARD- prefix variant
eq('FRW-BL-071 from "# CARD-FRW-BL-071: ..."',
  extractCardId('# CARD-FRW-BL-071: Fix cardId attribution\npersonaId: x'),
  // The regex strips the CARD- prefix? No — CARD- is the optional prefix before the segment.
  // The full match is "CARD-FRW-BL-071" which includes "CARD-" as the optional literal prefix.
  // Actually: (?:CARD-)? consumes "CARD-", then [A-Z][A-Z0-9]* matches "FRW", etc.
  // So the full match[0] is "CARD-FRW-BL-071"... wait, let's reason carefully.
  //
  // Input: "CARD-FRW-BL-071"
  // Pattern: \b(?:CARD-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\b
  //   \b            — word boundary before C
  //   (?:CARD-)?    — matches "CARD-"
  //   [A-Z][A-Z0-9]* — matches "FRW"
  //   (?:-[A-Z0-9]+)*— matches "-BL"
  //   -\d{3}        — matches "-071"
  //   \b            — word boundary after 1
  // Full match: "CARD-FRW-BL-071"
  'CARD-FRW-BL-071');

eq('FRW-BL-071 from bare "# FRW-BL-071: ..."',
  extractCardId('# FRW-BL-071: Fix cardId attribution'),
  'FRW-BL-071');

eq('CLR-FE-001 from realistic prompt',
  extractCardId('You are implementing CLR-FE-001: scaffold login page.'),
  'CLR-FE-001');

eq('CO-AZ-012 from realistic prompt',
  extractCardId('Card CO-AZ-012 requires Azure integration setup.'),
  'CO-AZ-012');

eq('CARD-BE-003 (legacy single-segment with CARD- prefix)',
  extractCardId('# CARD-BE-003: backend endpoint'),
  'CARD-BE-003');

eq('BE-003 (bare single-segment, no CARD- prefix)',
  extractCardId('Implement BE-003: auth middleware'),
  'BE-003');

// ---------------------------------------------------------------------------
// 3. REGRESSION — legacy single-segment CARD-XX-NNN still matches
// ---------------------------------------------------------------------------
console.log('\n3. Regression: single-segment CARD-XX-NNN');

eq('CARD-XX-123 still matched',
  extractCardId('Working on CARD-XX-123 today'),
  'CARD-XX-123');

eq('CARD-SK-001 from skills-api prompt',
  extractCardId('# CARD-SK-001: skills API\npersonaId: arch-01'),
  'CARD-SK-001');

// ---------------------------------------------------------------------------
// 4. NEGATIVE — prose / numbers do NOT produce false positives
// ---------------------------------------------------------------------------
console.log('\n4. Negative: prose must not match');

eq('"background color" → null', extractCardId('background color'), null);
eq('"I think 100" → null', extractCardId('I think 100'), null);
eq('"v5" → null', extractCardId('v5'), null);
eq('"version 2.0" → null', extractCardId('version 2.0'), null);
eq('"step 005 of 010" → null', extractCardId('step 005 of 010'), null);
eq('empty string → null', extractCardId(''), null);
eq('null input → null', extractCardId(null), null);
// A segment with only digits before the final 3-digit number should not match
// e.g. "123-456" — first segment must start with a letter [A-Z]
eq('"123-456" → null (digits-only prefix)', extractCardId('see issue 123-456'), null);

// ---------------------------------------------------------------------------
// 5. FIRST MATCH — when multiple ids in text, first wins
// ---------------------------------------------------------------------------
console.log('\n5. First match wins');

eq('first id returned when prompt has two',
  extractCardId('Depends on FRW-BL-069; implements FRW-BL-071'),
  'FRW-BL-069');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
