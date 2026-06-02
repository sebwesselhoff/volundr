// Self-test for boot-reconcile.mjs (FRW-BL-054). Run: node scripts/boot-reconcile.test.mjs
import { pickAnchorIso, findUnJournaledCommits, transcriptTouchedAfter, buildReconcileReport, toIsoUtc } from './boot-reconcile.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('boot-reconcile self-test\n');

// toIsoUtc — DB no-TZ timestamps are UTC (the bug that over-reported by ~2h)
ok('tz: DB "YYYY-MM-DD HH:MM:SS" → UTC ISO with Z', toIsoUtc('2026-06-02 23:48:03') === '2026-06-02T23:48:03Z');
ok('tz: already-ISO with offset is unchanged', toIsoUtc('2026-06-03T01:49:27+02:00') === '2026-06-03T01:49:27+02:00');
ok('tz: null → null', toIsoUtc(null) === null);
// regression: a commit 4 min BEFORE the anchor must NOT be flagged once the anchor is UTC-normalized
ok('tz: pre-anchor commit excluded with normalized UTC anchor',
   findUnJournaledCommits(toIsoUtc('2026-06-02 23:48:03'), [{ hash: 'x', iso: '2026-06-03T01:44:06+02:00', subject: 'pre' }]).length === 0);

// pickAnchorIso — most recent of journal vs checkpoint
ok('anchor: picks the later (journal newer)', pickAnchorIso('2026-06-02T22:00:00Z', '2026-06-02T20:00:00Z') === '2026-06-02T22:00:00Z');
ok('anchor: picks the later (checkpoint newer)', pickAnchorIso('2026-06-02T20:00:00Z', '2026-06-02T23:00:00Z') === '2026-06-02T23:00:00Z');
ok('anchor: journal only', pickAnchorIso('2026-06-02T20:00:00Z', null) === '2026-06-02T20:00:00Z');
ok('anchor: checkpoint only', pickAnchorIso(null, '2026-06-02T20:00:00Z') === '2026-06-02T20:00:00Z');
ok('anchor: neither → null', pickAnchorIso(null, null) === null);

// findUnJournaledCommits — commits strictly after the anchor
const commits = [
  { hash: 'aaa', iso: '2026-06-02T21:00:00Z', subject: 'before anchor' },
  { hash: 'bbb', iso: '2026-06-02T23:30:00Z', subject: 'AFTER anchor (un-journaled)' },
  { hash: 'ccc', iso: '2026-06-02T23:45:00Z', subject: 'AFTER anchor (un-journaled)' },
];
const anchor = '2026-06-02T22:00:00Z';
const un = findUnJournaledCommits(anchor, commits);
ok('unjournaled: only commits after the anchor', un.length === 2 && un.every(c => c.subject.includes('AFTER')));
ok('unjournaled: the before-anchor commit is excluded', !un.some(c => c.hash === 'aaa'));
ok('unjournaled: no anchor → all commits are unreconciled', findUnJournaledCommits(null, commits).length === 3);
ok('unjournaled: empty commits → empty', findUnJournaledCommits(anchor, []).length === 0);

// transcriptTouchedAfter
ok('transcript: touched after anchor → true', transcriptTouchedAfter('2026-06-02T22:00:00Z', Date.parse('2026-06-02T22:30:00Z')) === true);
ok('transcript: untouched (before anchor) → false', transcriptTouchedAfter('2026-06-02T22:00:00Z', Date.parse('2026-06-02T21:00:00Z')) === false);
ok('transcript: no mtime → false', transcriptTouchedAfter('2026-06-02T22:00:00Z', 0) === false);

// buildReconcileReport
const clean = buildReconcileReport({ anchorIso: anchor, unJournaled: [], transcriptTouched: false });
ok('report: clean when nothing un-journaled', clean.clean === true && /reconciled/.test(clean.text));
const dirty = buildReconcileReport({ anchorIso: anchor, unJournaled: un, transcriptTouched: true });
ok('report: flags un-journaled commits', dirty.clean === false && dirty.text.includes('bbb'.slice(0, 9)) && /un-journaled work/.test(dirty.text));
ok('report: notes transcript activity', /transcript was modified/.test(dirty.text));
ok('report: prompts to re-journal', /Re-journal/.test(dirty.text));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
