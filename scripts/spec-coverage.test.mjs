// spec-coverage.test.mjs — self-test for the FRW-BL-099 requirements-coverage analyzer.
// Run: node scripts/spec-coverage.test.mjs
// Deterministic, no network, no LLM. Every assertion is a pure call over synthetic documents.
//
// The three load-bearing fixtures are ISC-5's: an UNCOVERED requirement must be detected, a DRIFTED
// term must be detected, and a CLEAN blueprint must report neither. The third is the one that makes
// the other two meaningful — a checker that flags everything is as useless as one that flags nothing.

import {
  extractRequirements, citedIds, mapCoverage, extractGlossary, detectDrift,
  extractActiveRules, detectConstraintConflicts, isNegatedOccurrence, analyze, formatReport,
} from './spec-coverage.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ok ${label}`); } else { fail++; console.log(`  FAIL ${label}`); } };

const BLUEPRINT = [
  '# Example — Blueprint',
  '',
  '## Requirements',
  '- **FR-001**: The scanner authenticates with sign-in-with-Microsoft.',
  '- **FR-002**: The report is exportable as PDF.',
  '- **NFR-001**: A scan of 500 resources completes within 10 minutes.',
  '- **SC-001**: A pilot customer completes an assessment unaided.',
  '',
  '## Glossary',
  '- **assessment** (not: audit, review) — a point-in-time scored evaluation.',
  '- **landing zone** (not: landingzone, LZ) — the ALZ reference topology.',
  '',
  '## Notes',
  'Prose mentioning FR-001 in passing should not re-declare it.',
].join('\n');

const CARDS = [
  { id: 'CLR-001', status: 'done', title: 'Sign-in', description: 'Implements FR-001 via Entra.', isc: [] },
  { id: 'CLR-002', status: 'backlog', title: 'PDF export', description: 'Covers FR-002.', isc: [] },
  { id: 'CLR-003', status: 'backlog', title: 'Perf budget', description: 'Addresses NFR-001.', isc: [] },
];

// --- extraction ---------------------------------------------------------------
{
  const reqs = extractRequirements(BLUEPRINT);
  ok('extracts all four declared requirements', reqs.length === 4);
  ok('captures ids and text', reqs[0].id === 'FR-001' && /sign-in-with-Microsoft/.test(reqs[0].text));
  ok('supports FR, NFR and SC prefixes',
    reqs.map((r) => r.id).join(',') === 'FR-001,FR-002,NFR-001,SC-001');
  // The declaration-vs-citation distinction is what lets a card cite an id without redefining it.
  ok('a mid-sentence MENTION is not a declaration', reqs.filter((r) => r.id === 'FR-001').length === 1);
  ok('records the line number so a finding is navigable', reqs[0].line === 4);
}
{
  ok('a malformed id is not extracted', extractRequirements('- **FR-1**: too short').length === 0);
  ok('a prefixed lookalike is not extracted', extractRequirements('- **XFR-001**: not ours').length === 0);
  ok('empty and garbage input do not throw',
    extractRequirements('').length === 0 && extractRequirements(null).length === 0);
}
{
  const dupe = ['- **FR-001**: first meaning', '- **FR-001**: different meaning'].join('\n');
  const reqs = extractRequirements(dupe);
  ok('a duplicate id is flagged rather than silently overwriting', reqs.some((r) => r.duplicate));
  ok('the duplicate names both lines', reqs[1].firstSeenLine === 1 && reqs[1].line === 2);
}

// --- ISC-5 RED: an uncovered requirement -------------------------------------
{
  const r = analyze({ blueprint: BLUEPRINT, cards: CARDS });
  ok('RED: SC-001 has no covering card and is reported',
    r.coverage.uncovered.length === 1 && r.coverage.uncovered[0].id === 'SC-001');
  ok('the finding quotes the requirement so it is actionable',
    r.findings.some((f) => /SC-001/.test(f.detail) && /pilot customer/.test(f.detail)));
  ok('the three covered requirements are NOT reported', r.coverage.covered.length === 3);
  ok('coverage records which cards cover each requirement',
    r.coverage.covered.find((c) => c.id === 'FR-001').cards[0].id === 'CLR-001');
  ok('and how many of them are done', r.coverage.covered.find((c) => c.id === 'FR-001').done === 1);
}

// --- ISC-5 RED: a drifted term ------------------------------------------------
{
  const drifted = [{ name: 'sow-001', text: 'The audit produces a score for each landingzone.' }];
  const findings = detectDrift(extractGlossary(BLUEPRINT), drifted);
  ok('RED: a forbidden variant of a glossary term is detected', findings.length === 2);
  ok('the finding names the variant AND the canonical term',
    findings.some((f) => /"audit"/.test(f.detail) && /"assessment"/.test(f.detail)));
  ok('it names the source document', findings.every((f) => f.source === 'sow-001'));
}

// --- ISC-5 GREEN: a clean blueprint reports neither ---------------------------
{
  const cleanCards = [...CARDS, { id: 'CLR-004', status: 'backlog', title: 'Pilot', description: 'Covers SC-001.', isc: [] }];
  const r = analyze({ blueprint: BLUEPRINT, cards: cleanCards });
  ok('GREEN: full coverage reports no uncovered requirement', r.coverage.uncovered.length === 0);
  ok('GREEN: canonical terminology reports no drift', r.findings.filter((f) => /glossary/.test(f.detail)).length === 0);
  ok('GREEN: a clean run has no findings at all', r.findings.length === 0);
  ok('GREEN: and no CRITICALs', r.critical === 0);
}

// --- ISC-4: a card conflicting with an ACTIVE constraint is CRITICAL ----------
{
  const constraints = [
    '## Steering Rules',
    '- [CLR-010] Never store long-lived service principals in the scanner (score: 4.2, failed: correctness)',
    '- [SUPPRESSED] [CLR-011] Never use managed identities anywhere (score: 3.0, failed: correctness)',
  ].join('\n');
  const rules = extractActiveRules(constraints);
  ok('active steering rules are extracted', rules.length === 1 && rules[0].card === 'CLR-010');
  ok('a SUPPRESSED rule is NOT enforced — the operator switched it off deliberately',
    !rules.some((r) => /managed identities/.test(r.text)));

  const offending = [{ id: 'CLR-020', status: 'backlog', title: 'Auth', description: 'We will store long-lived service principals for convenience.' }];
  const conflicts = detectConstraintConflicts(offending, rules);
  ok('RED: a card contradicting an active rule is CRITICAL',
    conflicts.length === 1 && conflicts[0].severity === 'CRITICAL');
  ok('the conflict names both the card and the rule', /CLR-010/.test(conflicts[0].detail));

  ok('a card matching a SUPPRESSED rule is NOT flagged',
    detectConstraintConflicts([{ id: 'X', status: 'backlog', description: 'use managed identities' }], rules).length === 0);
  ok('a DONE card is not flagged — the conflict is about work still to come',
    detectConstraintConflicts([{ ...offending[0], status: 'done' }], rules).length === 0);
  ok('GREEN: a compliant card produces no conflict',
    detectConstraintConflicts([{ id: 'Y', status: 'backlog', description: 'Uses workload identity federation.' }], rules).length === 0);
}

// --- the FALSE CRITICAL a blind review reproduced ------------------------------
// A card describing COMPLIANT work quotes the forbidden phrase verbatim while promising the
// opposite. Flagging it CRITICAL means the most careful card in the backlog is the one most likely
// to trip the gate — and a CRITICAL that cries wolf gets the whole report ignored.
{
  const rules = [{ card: 'X-001', text: 'Never store customer PII in log files without encryption' }];
  const compliant = [{ id: 'SAFE-1', status: 'backlog', title: 'Audit',
    description: 'We will audit the code to ensure we do not store customer PII in log files without encryption.' }];
  ok('RED->GREEN: a card promising COMPLIANCE is not reported as proposing the violation',
    detectConstraintConflicts(compliant, rules).length === 0);

  const alsoCompliant = [{ id: 'SAFE-2', status: 'backlog', title: 'Guard',
    description: 'A guard prevents any path that would store customer PII in log files.' }];
  ok('"prevents X" is not "proposes X"', detectConstraintConflicts(alsoCompliant, rules).length === 0);

  // The violation must STILL be caught - the fix must not blunt the check into uselessness.
  const violating = [{ id: 'BAD-1', status: 'backlog', title: 'Logging',
    description: 'For debugging we will store customer PII in log files during the pilot.' }];
  ok('a genuine violation is STILL reported CRITICAL', detectConstraintConflicts(violating, rules).length === 1);

  // Mixed: one negated mention and one real proposal in the same card must still be flagged.
  const mixed = [{ id: 'BAD-2', status: 'backlog', title: 'Mixed',
    description: 'We must not store customer PII in log files. However for the pilot we will store customer PII in log files anyway.' }];
  ok('a card with BOTH a negated mention and a real proposal is still flagged',
    detectConstraintConflicts(mixed, rules).length === 1);

  ok('isNegatedOccurrence returns false when the phrase never appears',
    isNegatedOccurrence('unrelated text', 'store customer PII in log files') === false);
}

// --- the reverse gap and other ways this could be quietly wrong ---------------
{
  const orphan = [{ id: 'CLR-099', status: 'backlog', title: 'Mystery', description: 'Implements FR-404.' }];
  const r = analyze({ blueprint: BLUEPRINT, cards: orphan });
  ok('a card citing an id the blueprint never declares is reported',
    r.coverage.orphanCitations.some((o) => o.id === 'FR-404'));
  ok('and it surfaces as a finding when the blueprint HAS adopted the scheme',
    r.findings.some((f) => /FR-404/.test(f.detail)));
}
{
  // First-run noise: on a blueprint with NO ids, every id-shaped token in every card would be an
  // "orphan". A real run against `clear` produced 24 such warnings for its own unrelated SC-0xx
  // scheme. Suppressed, matching the "nothing to check" rule already applied to coverage.
  const noIds = analyze({
    blueprint: '# A blueprint that has not adopted the scheme',
    cards: [{ id: 'C1', status: 'backlog', description: 'relates to SC-016 and SC-017 and SC-018' }],
  });
  ok('orphan citations are NOT reported on a blueprint with zero requirement ids',
    noIds.findings.length === 0);
  ok('but they are still computed, so the data is available in --json',
    noIds.coverage.orphanCitations.length === 3);
}
{
  // The most dangerous outcome: an EMPTY blueprint reporting "all covered".
  const r = analyze({ blueprint: '# Nothing here', cards: CARDS });
  ok('a blueprint with no ids yields no requirements', r.requirements.length === 0);
  ok('and the report says "nothing to check", NOT "everything is covered"',
    /NOT "everything is covered"/.test(formatReport(r)));
}
{
  ok('citedIds finds every distinct id', citedIds('FR-001 and FR-001 and NFR-002').size === 2);
  ok('citedIds tolerates empty input', citedIds('').size === 0 && citedIds(null).size === 0);
  ok('analyze() with no arguments does not throw', analyze().findings.length === 0);
  ok('mapCoverage tolerates malformed cards',
    mapCoverage(extractRequirements(BLUEPRINT), [null, undefined, 'x', {}]).uncovered.length === 4);
  ok('detectDrift tolerates a missing glossary', detectDrift(null, [{ name: 'a', text: 'audit' }]).length === 0);
  ok('a glossary variant inside a longer word is NOT a match',
    detectDrift([{ canonical: 'zone', variants: ['LZ'] }], [{ name: 'a', text: 'the LZ-Group product' }]).length === 0);
}
{
  // Determinism: the same inputs must give byte-identical output, or this cannot be a gate.
  const a = JSON.stringify(analyze({ blueprint: BLUEPRINT, cards: CARDS }));
  const b = JSON.stringify(analyze({ blueprint: BLUEPRINT, cards: CARDS }));
  ok('the analysis is deterministic across runs (required for a gate)', a === b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
