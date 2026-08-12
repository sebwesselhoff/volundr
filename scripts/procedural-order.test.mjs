// procedural-order.test.mjs — self-test for the FRW-BL-103 ordering checker.
// Run: node scripts/procedural-order.test.mjs
// Deterministic, no network: every assertion is a pure call over a synthetic event array.
//
// The load-bearing fixture is the REAL INCIDENT: quality.md §4b requires the anti-stub scan to run
// before blind review, and a live session ran it AFTER the reviewers were already spawned with
// nothing to catch it. That out-of-order shape must be DETECTED, and the correct order must PASS.

import { checkOrdering, parseAttestation, ORDERING_RULES } from './procedural-order.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };

const CARD = 'FRW-BL-113';
const ev = (type, timestamp, detail, cardId = CARD) => ({ type, timestamp, detail, cardId });

// --- the real incident: scan AFTER the reviewer spawned ----------------------
{
  const outOfOrder = [
    ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: reviewer-frw-bl-113: Blind review'),
    ev('anti_stub_scan', '2026-08-12 13:04:10', 'anti-stub scan: 0 block, 0 warn across 3 non-test file(s)'),
  ];
  const r = checkOrdering(outOfOrder, CARD);
  ok('FIXTURE (real incident): an anti-stub scan recorded AFTER the reviewer spawn is DETECTED',
    r.violations.length === 1 && r.violations[0].rule === 'anti-stub-before-blind-review');
  ok('the violation quantifies how far out of order it was',
    /out of order by \d+s/.test(r.violations[0].detail));
  ok('the violation cites the rule source (quality.md §4b), so it is actionable',
    /quality\.md/.test(r.violations[0].detail));
}

// --- the correct order passes ------------------------------------------------
{
  const inOrder = [
    ev('anti_stub_scan', '2026-08-12 12:50:00', 'anti-stub scan: 0 block, 0 warn'),
    ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: reviewer-frw-bl-113: Blind review'),
  ];
  const r = checkOrdering(inOrder, CARD);
  ok('the correct order (scan then review) PASSES', r.violations.length === 0);
  ok('and reports the rule as ok with both timestamps', r.checked.some((c) => c.status === 'ok'));
}

// --- fails CLOSED when the scan left no trace -------------------------------
{
  const noScan = [ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: reviewer-x: Blind review')];
  const r = checkOrdering(noScan, CARD);
  ok('a reviewer spawned with NO anti-stub event at all is a VIOLATION (fails closed)',
    r.violations.length === 1 && /NO "anti_stub_scan" event/.test(r.violations[0].detail));
  ok('the message explains why absence is not success',
    /indistinguishable from a step that never ran/.test(r.violations[0].detail));
}

// --- re-running the scan afterwards does not repair the ordering ------------
{
  const scanTwice = [
    ev('anti_stub_scan', '2026-08-12 12:50:00', 'first scan'),
    ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: reviewer-x: Blind review'),
    ev('anti_stub_scan', '2026-08-12 13:10:00', 'scan re-run after the fact'),
  ];
  const r = checkOrdering(scanTwice, CARD);
  ok('a LATER scan does not repair the ordering — latest-before must still precede earliest-after',
    r.violations.length === 1);
}

// --- not-applicable when the review has not happened yet --------------------
{
  const scanOnly = [ev('anti_stub_scan', '2026-08-12 12:50:00', 'scan')];
  const r = checkOrdering(scanOnly, CARD);
  ok('a scan with no review yet is NOT a violation (ordering not exercised)', r.violations.length === 0);
  ok('and is reported as not-applicable rather than silently omitted',
    r.checked.some((c) => c.status === 'not-applicable'));
}

// --- scoping and robustness -------------------------------------------------
{
  const otherCard = [
    ev('anti_stub_scan', '2026-08-12 13:04:10', 'scan', 'FRW-BL-999'),
    ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: x', 'FRW-BL-999'),
  ];
  ok('events belonging to a DIFFERENT card do not affect this card',
    checkOrdering(otherCard, CARD).violations.length === 0);

  const nullCard = [
    ev('anti_stub_scan', '2026-08-12 13:04:10', 'scan', null),
    ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: x', null),
  ];
  ok('events with a null cardId are ignored, not attributed to this card',
    checkOrdering(nullCard, CARD).violations.length === 0);

  ok('a non-review agent_spawned does not trigger the rule',
    checkOrdering([
      ev('agent_spawned', '2026-08-12 12:56:26', 'developer spawned: a279f8e77ff540e5b'),
    ], CARD).violations.length === 0);

  ok('ISO and dashboard timestamp formats compare correctly (both treated as UTC)',
    checkOrdering([
      ev('anti_stub_scan', '2026-08-12T12:50:00.000Z', 'scan'),
      ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: x'),
    ], CARD).violations.length === 0);

  ok('an unparseable timestamp is dropped rather than throwing',
    (() => { try {
      checkOrdering([ev('anti_stub_scan', 'not-a-date', 'scan'), ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: x')], CARD);
      return true;
    } catch { return false; } })());

  ok('tolerates junk input without throwing',
    checkOrdering(null, CARD).violations.length === 0
    && checkOrdering([null, undefined, {}], CARD).violations.length === 0);

  ok('an identical before/after timestamp is a violation, not a pass (strictly-later required)',
    checkOrdering([
      ev('anti_stub_scan', '2026-08-12 12:56:26', 'scan'),
      ev('agent_spawned', '2026-08-12 12:56:26', 'review spawned: x'),
    ], CARD).violations.length === 1);
}

// --- the rule set itself ----------------------------------------------------
{
  ok('the anti-stub-before-blind-review rule exists and requires its before-event',
    ORDERING_RULES.some((r) => r.id === 'anti-stub-before-blind-review' && r.requireBefore === true));
  ok('every rule carries a source citation and a why, so a violation is explainable',
    ORDERING_RULES.every((r) => r.source && r.why));
}

// --- attestations (the non-ordering half) -----------------------------------
{
  const good = 'ATTEST [cross-model review offered]\nwhen: 2026-08-12T13:00:00Z\nwhat: offered a second reviewer; operator declined';
  const a = parseAttestation(good);
  ok('a complete attestation parses with subject, when and what', a.present && a.complete && /cross-model/.test(a.subject));
  ok('a missing ATTEST block is reported absent', parseAttestation('nothing here').present === false);
  ok('an attestation with no `when` is present but INCOMPLETE (uncheckable against a timeline)',
    (() => { const x = parseAttestation('ATTEST [thing]\nwhat: did the thing'); return x.present && !x.complete; })());
  ok('an attestation with an empty subject is incomplete',
    parseAttestation('ATTEST []\nwhen: now\nwhat: x').complete === false);
  ok('tolerates empty/undefined input', parseAttestation('').present === false && parseAttestation(undefined).present === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
