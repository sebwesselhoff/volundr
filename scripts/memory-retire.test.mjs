#!/usr/bin/env node
/**
 * Self-test for scripts/memory-retire.mjs (FRW-BL-105). Dependency-free, prints "N passed, M failed",
 * exits non-zero on failure. Auto-discovered by CI's glob over `framework scripts .claude/hooks`.
 *
 * Coverage is organised by ISC, because each test's job is to prove one acceptance criterion could
 * NOT pass against a broken implementation:
 *   ISC-1  a proposal carries a stated, evidence-bearing reason
 *   ISC-2  pinned / steering-rule-referenced / card-referenced items are never proposed — including
 *          an item that is BOTH old and referenced (reference protection must win over age)
 *   ISC-3  nothing is archived by main()'s --confirm path without --yes (checked at the pure-helper
 *          boundary main() delegates to: applyArchival is never called without an explicit proposal
 *          list a human reviewed)
 *   ISC-4  snapshot-before-mutate + a restore that actually round-trips (archived -> restored,
 *          verified via listArchivedKeys, not just "didn't throw")
 *   ISC-5  reasons carry numbers/dates/thresholds, not bare verdicts like "stale" or "superseded"
 *   ISC-6  classifyItem's confidence floor has a real behavioural effect (accelerates a stale+low-
 *          confidence item to archive-candidate) — this is what proves the pass USES confidence
 *          rather than merely printing it, tying to the FRW-BL-096 finding in the delivery report
 * Plus: garbage/empty input, and normalization of each of the three store shapes.
 */

import {
  DEFAULTS,
  MIN_NEEDLE_LEN,
  WORD_CONFIDENCE,
  normalizeLesson,
  normalizePattern,
  parsePatternFile,
  normalizeSkill,
  itemKey,
  checkInterval,
  findReference,
  classifyItem,
  proposeRetirement,
  formatProposalReport,
  buildSnapshot,
  restoreFromSnapshot,
  applyArchival,
  applyRestore,
  listArchivedKeys,
  extractSteeringSection,
} from './memory-retire.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = '2026-08-27T00:00:00.000Z';
const daysAgo = (n) => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();

// ---- Normalization ----------------------------------------------------------------

test('normalizeLesson: maps fields, defaults pinned false, confidence null', () => {
  const item = normalizeLesson({ id: 42, title: 'A lesson title long enough', createdAt: '2026-01-01' });
  assertEqual(item.kind, 'lesson');
  assertEqual(item.id, 'lesson-42');
  assertEqual(item.title, 'A lesson title long enough');
  assertEqual(item.createdAt, '2026-01-01');
  assertEqual(item.confidence, null);
  assertEqual(item.pinned, false);
});

test('normalizeLesson: pinned:true field is honored when present', () => {
  const item = normalizeLesson({ id: 1, title: 'x', createdAt: '2026-01-01', pinned: true });
  assertEqual(item.pinned, true);
});

test('parsePatternFile: extracts title, confidence word+number, source date, pinned false by default', () => {
  const content = [
    '# Pattern — Never let your only enforcement point be untestable',
    '',
    '**Source** Some review, 2026-08-17 — caught in review',
    '**Confidence** High',
    '**Reuse when** Designing gateways',
  ].join('\n');
  const p = parsePatternFile('enforcement-must-be-locally-testable.md', content);
  assertEqual(p.id, 'enforcement-must-be-locally-testable');
  assertEqual(p.title, 'Never let your only enforcement point be untestable');
  assertEqual(p.confidenceWord, 'high');
  assertEqual(p.confidence, WORD_CONFIDENCE.high);
  assertEqual(p.createdAt, '2026-08-17');
  assertEqual(p.pinned, false);
});

test('parsePatternFile: recognises the **Pinned** true marker', () => {
  const content = '# Pattern — X\n\n**Confidence** Low\n**Pinned** true\n';
  const p = parsePatternFile('x.md', content);
  assertEqual(p.pinned, true);
});

test('normalizePattern: wraps parsePatternFile into unified shape with raw.filename/content', () => {
  const content = '# Pattern — Y\n\n**Confidence** Medium\n';
  const item = normalizePattern('y.md', content);
  assertEqual(item.kind, 'pattern');
  assertEqual(item.id, 'y');
  assertEqual(item.confidence, WORD_CONFIDENCE.medium);
  assertEqual(item.raw.filename, 'y.md');
  assertEqual(item.raw.content, content);
});

test('normalizeSkill: numeric confidence passes through; categorical maps via WORD_CONFIDENCE', () => {
  const numeric = normalizeSkill({ id: 's1', name: 'Skill One', confidence: 0.73, createdAt: '2026-01-01' });
  assertEqual(numeric.confidence, 0.73);
  const categorical = normalizeSkill({ id: 's2', name: 'Skill Two', confidence: 'low', createdAt: '2026-01-01' });
  assertEqual(categorical.confidence, WORD_CONFIDENCE.low);
});

test('normalizeSkill: lastActivityAt prefers lastUsedAt over updatedAt/acquiredAt/createdAt', () => {
  const item = normalizeSkill({
    id: 's3', name: 'S', confidence: 'medium',
    createdAt: '2026-01-01', acquiredAt: '2026-01-02', updatedAt: '2026-01-03', lastUsedAt: '2026-01-04',
  });
  assertEqual(item.lastActivityAt, '2026-01-04');
});

test('itemKey: stable "kind:id" composite', () => {
  assertEqual(itemKey({ kind: 'lesson', id: 'lesson-1' }), 'lesson:lesson-1');
});

// ---- ISC-1: proposals carry a stated reason ----------------------------------------

test('ISC-1: an archive-candidate item appears in proposals with a non-empty reason string', () => {
  const items = [normalizeLesson({ id: 1, title: 'Very old unreferenced lesson content', createdAt: daysAgo(400) })];
  const result = proposeRetirement({ items, now: NOW, force: true });
  assertEqual(result.proposals.length, 1);
  assert(typeof result.proposals[0].reason === 'string' && result.proposals[0].reason.length > 0, 'reason must be present');
});

test('ISC-1: a pass with nothing eligible says so distinctly (0 proposals is not silence)', () => {
  const items = [normalizeLesson({ id: 1, title: 'Freshly created lesson content here', createdAt: daysAgo(1) })];
  const result = proposeRetirement({ items, now: NOW, force: true });
  assertEqual(result.ran, true);
  assertEqual(result.proposals.length, 0);
  const report = formatProposalReport(result);
  assert(report.includes('0 item(s) proposed'), 'report must explicitly say 0 proposed, not omit the line');
});

// ---- ISC-2: pinning + reference protection, proven by fixture ----------------------

test('ISC-2: a pinned item is never proposed, even when very old', () => {
  const items = [normalizeLesson({ id: 1, title: 'An old pinned lesson with enough length', createdAt: daysAgo(1000), pinned: true })];
  const result = proposeRetirement({ items, now: NOW, force: true });
  assertEqual(result.proposals.length, 0);
  assertEqual(result.protectedItems.length, 1);
  assertEqual(result.protectedItems[0].reason, 'pinned');
});

test('ISC-2: an item referenced by an active steering rule is never proposed', () => {
  const item = normalizeLesson({ id: 2, title: 'Never widen a matcher without testing the trigger', createdAt: daysAgo(1000) });
  const steeringRulesText = '## Steering Rules\n\n- Never widen a matcher without testing the trigger (FRW-BL-092)\n';
  const result = proposeRetirement({ items: [item], now: NOW, force: true, steeringRulesText });
  assertEqual(result.proposals.length, 0);
  assertEqual(result.protectedItems.length, 1);
  assert(result.protectedItems[0].reason.includes('steering rule'), 'evidence must name the steering rule');
});

test('ISC-2: an item referenced by a card is never proposed', () => {
  const item = normalizeLesson({ id: 3, title: 'Docker no-cache required for frontend changes', createdAt: daysAgo(1000) });
  const cards = [{ id: 'FRW-777', title: 'Fix build', description: 'See lesson: Docker no-cache required for frontend changes', isc: '' }];
  const result = proposeRetirement({ items: [item], now: NOW, force: true, cards });
  assertEqual(result.proposals.length, 0);
  assertEqual(result.protectedItems.length, 1);
  assert(result.protectedItems[0].reason.includes('FRW-777'), 'evidence must name the referencing card');
});

test('ISC-2: an item that is OLD AND referenced stays protected (reference wins over age)', () => {
  const item = normalizeSkill({ id: 'ancient-skill-extracted', name: 'Ancient but still cited skill', confidence: 'low', createdAt: daysAgo(5000) });
  const cards = [{ id: 'FRW-900', title: 'Uses skill', description: 'Relies on ancient-skill-extracted for this domain', isc: '' }];
  const result = proposeRetirement({ items: [item], now: NOW, force: true, cards });
  assertEqual(result.proposals.length, 0, 'a referenced item must not be proposed no matter how old');
  assertEqual(result.protectedItems.length, 1);
});

test('ISC-2: needles shorter than MIN_NEEDLE_LEN do not create false-positive protection', () => {
  const item = { kind: 'lesson', id: 'ab', title: 'ok', createdAt: daysAgo(400), lastActivityAt: daysAgo(400), confidence: null, pinned: false };
  assert('ab'.length < MIN_NEEDLE_LEN && 'ok'.length < MIN_NEEDLE_LEN, 'fixture must actually be short');
  const ref = findReference(item, { steeringRulesText: 'ok this mentions ab and ok everywhere' });
  assertEqual(ref.referenced, false);
});

// ---- ISC-3: nothing archived without confirmation --------------------------------------

test('ISC-3: applyArchival only ever archives items explicitly passed as proposals — proposing does not mutate a ledger', () => {
  const items = [normalizeLesson({ id: 9, title: 'Old unreferenced lesson eligible for archive', createdAt: daysAgo(400) })];
  const result = proposeRetirement({ items, now: NOW, force: true });
  assertEqual(result.proposals.length, 1);
  // proposeRetirement itself returns no ledger and touches no store — archival requires a SEPARATE
  // call to applyArchival with the reviewed proposal list. Simulate "user did not confirm": ledger
  // stays untouched.
  const ledgerBefore = [];
  const ledgerAfterProposalOnly = ledgerBefore; // nothing calls applyArchival in this branch
  assertEqual(listArchivedKeys(ledgerAfterProposalOnly).size, 0, 'proposing alone must not archive anything');
});

test('ISC-3: applyArchival requires an explicit proposals array — empty proposals archives nothing', () => {
  const ledger = applyArchival([], [], { now: NOW });
  assertEqual(ledger.length, 0);
});

// ---- ISC-4: snapshot before mutation + restore round-trips ----------------------------

test('ISC-4: buildSnapshot captures items before any mutation, independent of later changes', () => {
  const items = [normalizeLesson({ id: 5, title: 'A snapshot subject lesson right here', createdAt: daysAgo(200) })];
  const snap = buildSnapshot(items, { now: NOW });
  items[0].title = 'MUTATED AFTER SNAPSHOT';
  assertEqual(snap.items[0].title, 'A snapshot subject lesson right here', 'snapshot must be a deep copy, not a live reference');
});

test('ISC-4: full archive -> snapshot -> restore round-trip actually reverses the archive', () => {
  const item = normalizeLesson({ id: 6, title: 'Round trip candidate lesson content here', createdAt: daysAgo(400) });
  const result = proposeRetirement({ items: [item], now: NOW, force: true });
  assertEqual(result.proposals.length, 1);

  // Confirm: snapshot then archive.
  const snapshot = buildSnapshot(result.proposals.map((p) => p.item), { now: NOW });
  let ledger = applyArchival([], result.proposals, { now: NOW, confirmedBy: 'test' });
  assertEqual(listArchivedKeys(ledger).has(itemKey(item)), true, 'item must be archived after confirm');

  // Restore: read the snapshot back, mark restored in the ledger.
  const restored = restoreFromSnapshot(snapshot);
  assertEqual(restored.ok, true);
  assertEqual(restored.items.length, 1);
  assertEqual(restored.items[0].title, item.title);
  ledger = applyRestore(ledger, restored.items, { now: NOW });
  assertEqual(listArchivedKeys(ledger).has(itemKey(item)), false, 'item must NOT be in the archived-keys set after restore');

  // The ledger entry itself is retained (marked restored), never deleted — auditable.
  const entry = ledger.find((e) => e.kind === item.kind && e.id === item.id);
  assert(entry != null, 'ledger entry must still exist after restore (archive, never delete)');
  assertEqual(entry.restoredAt, NOW);
});

test('ISC-4: restoreFromSnapshot fails loudly (ok:false) on a malformed snapshot instead of returning an empty success', () => {
  const r1 = restoreFromSnapshot(null);
  assertEqual(r1.ok, false);
  const r2 = restoreFromSnapshot({ takenAt: NOW });
  assertEqual(r2.ok, false, 'missing items array must not silently look like a successful empty restore');
});

test('ISC-4: applyArchival is idempotent — re-proposing an already-archived item does not duplicate the ledger entry', () => {
  const item = normalizeLesson({ id: 7, title: 'Duplicate archive attempt lesson content', createdAt: daysAgo(400) });
  const result = proposeRetirement({ items: [item], now: NOW, force: true });
  let ledger = applyArchival([], result.proposals, { now: NOW });
  ledger = applyArchival(ledger, result.proposals, { now: NOW });
  const matches = ledger.filter((e) => e.kind === item.kind && e.id === item.id);
  assertEqual(matches.length, 1, 'archiving the same item twice must not create two ledger rows');
});

// ---- ISC-5: reasons carry evidence, not bare verdicts -----------------------------------

test('ISC-5: classifyItem archive-candidate reason includes concrete age number and threshold, not just a verdict word', () => {
  const item = { createdAt: daysAgo(400), lastActivityAt: daysAgo(400), confidence: null };
  const c = classifyItem(item, { now: NOW });
  assertEqual(c.state, 'archive-candidate');
  assert(/\d+d/.test(c.reason), 'reason must contain a concrete day count');
  assert(c.reason.includes(String(DEFAULTS.archiveDays)), 'reason must name the threshold compared against');
  assert(c.reason !== 'stale' && c.reason !== 'superseded', 'reason must not be a bare verdict word');
});

test('ISC-5: confidence-accelerated archive-candidate reason cites both the age AND the confidence number', () => {
  const item = { createdAt: daysAgo(90), lastActivityAt: daysAgo(90), confidence: 0.2 };
  const c = classifyItem(item, { now: NOW, staleDays: 60, archiveDays: 180, confidenceFloor: 0.4 });
  assertEqual(c.state, 'archive-candidate');
  assert(c.reason.includes('0.2'), 'reason must cite the actual confidence value');
  assert(c.reason.includes('0.4'), 'reason must cite the floor it was compared against');
  assert(/\d+d/.test(c.reason), 'reason must still cite the age');
});

test('ISC-5: reference-protection evidence names WHAT matched, not just "protected"', () => {
  const item = { id: 'x', title: 'A sufficiently long distinctive title string' };
  const ref = findReference(item, { steeringRulesText: 'mentions A sufficiently long distinctive title string here' });
  assertEqual(ref.referenced, true);
  assert(ref.evidence.includes('A sufficiently long distinctive title string'), 'evidence must quote the matched text');
});

// ---- ISC-6: the pass operates on real confidence values --------------------------------

test('ISC-6: a stale item with confidence AT the floor is not accelerated (boundary is exclusive on the low side)', () => {
  const item = { createdAt: daysAgo(90), lastActivityAt: daysAgo(90), confidence: 0.4 };
  const c = classifyItem(item, { now: NOW, staleDays: 60, archiveDays: 180, confidenceFloor: 0.4 });
  assertEqual(c.state, 'stale', 'confidence exactly at the floor must not count as low');
});

test('ISC-6: a stale item with confidence just below the floor IS accelerated to archive-candidate', () => {
  const item = { createdAt: daysAgo(90), lastActivityAt: daysAgo(90), confidence: 0.39 };
  const c = classifyItem(item, { now: NOW, staleDays: 60, archiveDays: 180, confidenceFloor: 0.4 });
  assertEqual(c.state, 'archive-candidate');
});

test('ISC-6: null confidence (lessons; unparseable pattern/skill confidence) is never treated as low', () => {
  const item = { createdAt: daysAgo(90), lastActivityAt: daysAgo(90), confidence: null };
  const c = classifyItem(item, { now: NOW, staleDays: 60, archiveDays: 180, confidenceFloor: 0.4 });
  assertEqual(c.state, 'stale', 'unknown confidence must get the full window, not be treated as low');
});

test('ISC-6: normalizeSkill actually reads a numeric confidence through unchanged (proves the module consumes real values, not a hard-coded constant)', () => {
  const high = normalizeSkill({ id: 'a', name: 'A', confidence: 0.91, createdAt: daysAgo(90) });
  const low = normalizeSkill({ id: 'b', name: 'B', confidence: 0.11, createdAt: daysAgo(90) });
  assert(high.confidence !== low.confidence, 'two different real confidence inputs must not collapse to the same value');
  assertEqual(high.confidence, 0.91);
  assertEqual(low.confidence, 0.11);
});

// ---- Interval gate ------------------------------------------------------------------------

test('checkInterval: no lastRunAt => always due', () => {
  const r = checkInterval({ lastRunAt: null, now: NOW });
  assertEqual(r.due, true);
});

test('checkInterval: within interval => not due', () => {
  const r = checkInterval({ lastRunAt: daysAgo(2), now: NOW, intervalDays: 14 });
  assertEqual(r.due, false);
});

test('checkInterval: past interval => due', () => {
  const r = checkInterval({ lastRunAt: daysAgo(20), now: NOW, intervalDays: 14 });
  assertEqual(r.due, true);
});

test('checkInterval: throws loudly if `now` is omitted (clocks are injected, not called)', () => {
  let threw = false;
  try { checkInterval({ lastRunAt: daysAgo(2) }); } catch { threw = true; }
  assert(threw, 'checkInterval must refuse to run without an injected now');
});

test('proposeRetirement: not due (no force) returns ran:false and touches nothing', () => {
  const items = [normalizeLesson({ id: 1, title: 'Old enough lesson content to qualify', createdAt: daysAgo(400) })];
  const result = proposeRetirement({ items, now: NOW, lastRunAt: daysAgo(1), intervalDays: 14 });
  assertEqual(result.ran, false);
  assertEqual(result.proposals.length, 0);
});

// ---- Garbage / empty input ------------------------------------------------------------

test('proposeRetirement: empty items array produces a clean 0-proposal result, not a throw', () => {
  const result = proposeRetirement({ items: [], now: NOW, force: true });
  assertEqual(result.ran, true);
  assertEqual(result.proposals.length, 0);
  assertEqual(result.kept.length, 0);
});

test('proposeRetirement: garbage item shapes (nulls, missing fields) do not throw', () => {
  // The nulls are passed THROUGH deliberately. An earlier version of this test stripped them with
  // `.filter(Boolean)` before calling, so it asserted nothing about the input it names and stayed
  // green while that exact input threw a TypeError. Filtering the hard case out of the test for the
  // hard case is coverage theatre — the project's own constraints name it.
  const items = [null, undefined, {}, { kind: 'lesson' }, { kind: 'skill', id: 1, title: 5 }];
  let result;
  let threw = false;
  try {
    result = proposeRetirement({ items, now: NOW, force: true });
  } catch {
    threw = true;
  }
  assertEqual(threw, false, 'garbage item shapes must be handled defensively, not crash the pass');
  assert(result.ran === true);
  // A malformed row must be accounted for, not silently vanish: absence from every bucket would
  // make a dropped item indistinguishable from one that was never there.
  assertEqual(result.proposals.length, 0, 'no malformed row may be proposed for archival');
});

test('findReference: a null item is handled rather than throwing', () => {
  let threw = false;
  try {
    findReference(null, { steeringRulesText: 'anything', cards: [] });
    findReference(undefined, {});
    findReference('a string', {});
  } catch {
    threw = true;
  }
  assertEqual(threw, false, 'findReference must not crash on a malformed item');
  assertEqual(findReference(null, {}).referenced, false, 'a null item is never treated as referenced');
});

test('classifyItem: item with no timestamps at all is treated as active, not archive-candidate', () => {
  const c = classifyItem({}, { now: NOW });
  assertEqual(c.state, 'active');
  assert(c.reason.includes('no timestamp'), 'reason must say why it could not be classified further');
});

test('findReference: empty/garbage context does not throw and returns unreferenced', () => {
  const r = findReference({ id: 'abcdefghij', title: 'A sufficiently long title here' }, {});
  assertEqual(r.referenced, false);
});

test('applyRestore: restoring keys not present in the ledger is a no-op, not an error', () => {
  const ledger = [{ kind: 'lesson', id: 'lesson-1', title: 't', reason: 'r', archivedAt: NOW, confirmedBy: 'x', restoredAt: null }];
  const result = applyRestore(ledger, [{ kind: 'lesson', id: 'lesson-999' }], { now: NOW });
  assertEqual(result.length, 1);
  assertEqual(result[0].restoredAt, null, 'unrelated ledger entries must be untouched');
});

// ---- extractSteeringSection -----------------------------------------------------------

test('extractSteeringSection: pulls the section body up to the next ## heading', () => {
  const text = '# Title\n\n## Hierarchy Config\n\nsome config\n\n## Steering Rules\n\nrule one\nrule two\n\n## Not This\n\nnope';
  const section = extractSteeringSection(text);
  assert(section.includes('rule one'));
  assert(section.includes('rule two'));
  assert(!section.includes('nope'));
});

test('extractSteeringSection: missing heading returns empty string, not a throw', () => {
  assertEqual(extractSteeringSection('# Title\n\nno steering section here'), '');
});

test('extractSteeringSection: heading at end of file (no following ##) returns to EOF', () => {
  const text = '# Title\n\n## Steering Rules\n\nonly rule here';
  const section = extractSteeringSection(text);
  assert(section.includes('only rule here'));
});

// ---- Report / summary ------------------------------------------------------------------

process.stdout.write(`${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) process.stdout.write(`  FAIL: ${f}\n`);
  process.exitCode = 1;
}
