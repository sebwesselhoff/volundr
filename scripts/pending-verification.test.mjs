// pending-verification.test.mjs — self-test for the FRW-BL-111 deferred-criteria register.
// Run: node scripts/pending-verification.test.mjs
// Deterministic, no network: every assertion is a pure call over a synthetic event array.
//
// The load-bearing fixtures are the REAL entries this register was built to hold: FRW-BL-093's
// Monitor-matcher probe (deferred to a restart, then closed by the next boot) and FRW-BL-112 ISC-2
// (operator-gated, still open). If the register cannot tell those two apart it is the "list nobody
// trusts" the card explicitly warns against.

import {
  entryKey, parseEntry, computePending, formatReport, validateAdd, clip,
  DEFERRED_EVENT, RESOLVED_EVENT, GATES,
} from './pending-verification.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ok ${label}`); } else { fail++; console.log(`  FAIL ${label}`); } };

const ev = (type, cardId, payload, timestamp = '2026-08-12 09:00:00') =>
  ({ type, cardId, detail: JSON.stringify(payload), timestamp });

const DEFER_093 = ev(DEFERRED_EVENT, 'FRW-BL-093', {
  card: 'FRW-BL-093', isc: 'ISC-4', gate: 'restart',
  criterion: 'A command blocked by the BLOCKED tier is blocked when issued through the Monitor tool',
  why: 'Hook matcher registration is boot-read, so the session that widened the matcher cannot observe its own change.',
  at: '2026-08-11T20:10:00Z',
});
const RESOLVE_093 = ev(RESOLVED_EVENT, 'FRW-BL-093', {
  card: 'FRW-BL-093', isc: 'ISC-4',
  outcome: 'Closed on the first action of the next boot: `git add -A --dry-run` through Monitor was rejected at PreToolUse.',
  at: '2026-08-12T09:39:21Z',
});
const DEFER_112 = ev(DEFERRED_EVENT, 'FRW-BL-112', {
  card: 'FRW-BL-112', isc: 'ISC-2', gate: 'operator',
  criterion: 'Whether Edit is restricted identically to Write is determined rather than assumed',
  why: 'No model can invoke the six denylisted skills, so no automated path can trigger the denial.',
  how: 'Operator types /vldr-route, then asks for a file Write and a file Edit in the same session.',
  at: '2026-08-12T15:00:00Z',
});

// --- the real scenario -------------------------------------------------------
{
  const { pending, resolved } = computePending([DEFER_093, RESOLVE_093, DEFER_112]);
  ok('REAL FIXTURE: the resolved FRW-BL-093 probe is NOT pending', !pending.some((p) => p.cardId === 'FRW-BL-093'));
  ok('REAL FIXTURE: the open FRW-BL-112 ISC-2 IS pending', pending.some((p) => p.cardId === 'FRW-BL-112' && p.isc === 'ISC-2'));
  ok('exactly one entry is pending', pending.length === 1);
  ok('the resolved entry is retained with its resolution, not discarded',
    resolved.length === 1 && /first action of the next boot/.test(resolved[0].resolution.outcome));
  ok('the pending entry keeps its how-to-close instructions', /vldr-route/.test(pending[0].how));
}

// --- order independence (the API returns newest-first, a file oldest-first) ---
{
  const forward = computePending([DEFER_093, RESOLVE_093, DEFER_112]);
  const reversed = computePending([DEFER_112, RESOLVE_093, DEFER_093]);
  ok('a resolution cancels its deferral regardless of array order',
    forward.pending.length === reversed.pending.length && forward.pending[0].key === reversed.pending[0].key);
}

// --- the gate distinction (ISC-3) --------------------------------------------
{
  const all = computePending([DEFER_093, DEFER_112]);
  ok('both gate kinds are held at once', all.pending.length === 2);
  ok('--gate restart returns only the restart-gated entry',
    computePending([DEFER_093, DEFER_112], { gate: 'restart' }).pending.every((p) => p.cardId === 'FRW-BL-093'));
  ok('--gate operator returns only the operator-gated entry',
    computePending([DEFER_093, DEFER_112], { gate: 'operator' }).pending.every((p) => p.cardId === 'FRW-BL-112'));
  ok('restart-gated entries sort FIRST (this boot can act on them)', all.pending[0].gate === 'restart');
  ok('only two gate kinds exist', GATES.length === 2 && GATES.includes('restart') && GATES.includes('operator'));
}

// --- keys --------------------------------------------------------------------
{
  ok('the ISC tag is preferred over criterion text',
    entryKey('FRW-BL-112', { isc: 'ISC-2', criterion: 'anything at all' }) === 'FRW-BL-112::ISC-2');
  ok('card id is case-normalised', entryKey('frw-bl-112', { isc: 'isc-2' }) === 'FRW-BL-112::ISC-2');
  ok('free-text keys survive whitespace, case and a trailing period',
    entryKey('X', { criterion: 'The  Thing   Is True.' }) === entryKey('X', { criterion: 'the thing is true' }));
  ok('a key needs a card', entryKey('', { isc: 'ISC-1' }) === null);
  ok('a key needs either an isc or a criterion', entryKey('X', {}) === null);
}

// --- ways this could be quietly wrong ----------------------------------------
{
  // Same ISC tag, DIFFERENT card: must not cross-cancel. Every card has an ISC-2.
  const otherCard = ev(RESOLVED_EVENT, 'FRW-BL-999', { card: 'FRW-BL-999', isc: 'ISC-2', outcome: 'unrelated' });
  const r = computePending([DEFER_112, otherCard]);
  ok('a resolution for a DIFFERENT card with the same ISC tag does not cancel', r.pending.length === 1);
}
{
  const dup = ev(DEFERRED_EVENT, 'FRW-BL-112',
    { card: 'FRW-BL-112', isc: 'ISC-2', gate: 'operator', criterion: 'same', why: 'hit the same wall again', at: '2026-08-20T10:00:00Z' });
  const r = computePending([DEFER_112, dup]);
  ok('re-registering the same criterion collapses to ONE entry', r.pending.length === 1);
  ok('and keeps the EARLIEST deferral date, so "waiting since" stays honest', r.pending[0].at === '2026-08-12T15:00:00Z');
}
{
  const malformed = { type: DEFERRED_EVENT, cardId: 'FRW-BL-001', detail: '{not json', timestamp: '2026-08-12 09:00:00' };
  const r = computePending([DEFER_112, malformed]);
  ok('a malformed payload does not throw', r.pending.length === 1);
  ok('and is COUNTED rather than silently dropped', r.malformed === 1);
  ok('the report surfaces the malformed count, so the total is never falsely reassuring',
    /may be higher/.test(formatReport(r.pending, { malformed: r.malformed })));
}
{
  const noise = [
    { type: 'agent_spawned', cardId: 'FRW-BL-112', detail: 'review spawned', timestamp: '2026-08-12 09:00:00' },
    { type: 'branch_merged', cardId: 'FRW-BL-112', detail: 'merged', timestamp: '2026-08-12 09:00:00' },
  ];
  ok('unrelated event types are ignored entirely', computePending(noise).pending.length === 0);
  ok('and are not counted as malformed', computePending(noise).malformed === 0);
}
{
  ok('empty input does not throw', computePending([]).pending.length === 0);
  ok('garbage input does not throw', computePending(null).pending.length === 0 && computePending(undefined).malformed === 0);
  ok('a null event in the array does not throw', computePending([null, DEFER_112]).pending.length === 1);
}
{
  // A deferral event whose payload is valid JSON but not an object (e.g. a bare string) must be
  // rejected as malformed rather than read as an entry with undefined everything.
  const scalar = { type: DEFERRED_EVENT, cardId: 'X', detail: '"just a string"', timestamp: '2026-08-12 09:00:00' };
  const r = computePending([scalar]);
  ok('a non-object payload is malformed, not an entry', r.pending.length === 0 && r.malformed === 1);
}
{
  ok('parseEntry returns null for a non-register event',
    parseEntry({ type: 'agent_spawned', detail: '{}' }) === null);
  ok('parseEntry falls back to the payload card when the event row has no cardId',
    parseEntry({ type: DEFERRED_EVENT, detail: JSON.stringify({ card: 'FRW-BL-050', isc: 'ISC-1' }) }).cardId === 'FRW-BL-050');
}

// --- report ------------------------------------------------------------------
{
  ok('an empty register says so explicitly', /nothing awaiting verification/.test(formatReport([])));
  const text = formatReport(computePending([DEFER_093, DEFER_112]).pending);
  ok('a non-empty report never claims nothing is pending', !/nothing awaiting verification/.test(text));
  ok('the report separates restart-gated from operator-gated', /RESTART-GATED/.test(text) && /OPERATOR-GATED/.test(text));
  ok('the report states restart entries are actionable at this boot', /actionable NOW/.test(text));
  ok('the report says restarting will NOT close operator entries', /restarting will not close/i.test(text));

  // Compact is the DEFAULT because this prints at every boot and a wall of prose is a banner
  // nobody reads — the same failure as no register, only more expensive.
  ok('the default is ONE line per entry, not a prose block', !/why deferred:/.test(text));
  ok('every pending entry still appears in compact form',
    /FRW-BL-093/.test(text) && /FRW-BL-112/.test(text));
  ok('compact output stays small (<= 3 lines per entry incl. headers)', text.split('\n').length <= 12);
  ok('compact output points at how to get the detail', /--verbose/.test(text));

  const loud = formatReport(computePending([DEFER_093, DEFER_112]).pending, { verbose: true });
  ok('--verbose shows why each was deferred', /why deferred:/.test(loud));
  ok('--verbose shows how to close it', /how to close:/.test(loud));
  ok('--verbose does not advertise itself', !/--verbose/.test(loud));

  const longOne = computePending([ev(DEFERRED_EVENT, 'FRW-BL-500', {
    card: 'FRW-BL-500', isc: 'ISC-1', gate: 'restart', why: 'w',
    criterion: 'A criterion long enough that it will certainly exceed the compact single line budget and therefore has to be trimmed somewhere sensible rather than mid-word',
  })]).pending;
  const clipped = formatReport(longOne);
  ok('a long criterion is clipped rather than wrapped onto many lines',
    clipped.split('\n').every((l) => l.length < 140));
  ok('the clip is marked with an ellipsis', /…/.test(clipped));
}

// --- clip: the compact line's only real logic --------------------------------
{
  const LONG = 'A criterion long enough that it will certainly exceed the compact single line budget and therefore must be trimmed';
  const out = clip(LONG, 40);
  ok('clip respects the budget', out.length <= 41);
  ok('clip ends with an ellipsis when it trimmed', out.endsWith('…'));
  // The load-bearing contract: what remains must be a WHOLE-WORD prefix of the original, so the
  // reader never sees a mangled half-word that changes the meaning of the criterion.
  const shown = out.slice(0, -1);
  ok('what remains is a whole-word prefix of the original',
    LONG.startsWith(shown) && (LONG[shown.length] === ' ' || LONG.length === shown.length));
  ok('a short string is returned untouched, with no ellipsis', clip('short enough', 40) === 'short enough');
  ok('an exactly-at-budget string is not clipped', clip('12345', 5) === '12345');
  ok('internal whitespace is collapsed so one entry stays one line',
    clip('a\n  b\tc', 40) === 'a b c');
  ok('null and undefined do not throw', clip(null) === '' && clip(undefined) === '');
  // A single word longer than the budget has no space to break on; it must still be trimmed to
  // budget rather than returned whole, or the "one line" guarantee is a lie.
  const oneWord = clip('x'.repeat(200), 20);
  ok('a single over-long word is still cut to budget', oneWord.length <= 21 && oneWord.endsWith('…'));
}

// --- write validation --------------------------------------------------------
{
  const good = validateAdd({ card: 'X', gate: 'restart', criterion: 'c', isc: 'ISC-1', why: 'w' });
  ok('a complete entry validates clean', good.problems.length === 0 && good.warnings.length === 0);
  ok('a missing card is a problem', validateAdd({ gate: 'restart', criterion: 'c', why: 'w' }).problems.some((p) => /--card/.test(p)));
  ok('a missing why is a problem — an unexplained entry is indistinguishable from unfinished work',
    validateAdd({ card: 'X', gate: 'restart', criterion: 'c' }).problems.some((p) => /--why/.test(p)));
  ok('an invalid gate is REJECTED at write time, not stored',
    validateAdd({ card: 'X', gate: 'reboot', criterion: 'c', why: 'w' }).problems.some((p) => /--gate/.test(p)));
  ok('a missing gate is rejected', validateAdd({ card: 'X', criterion: 'c', why: 'w' }).problems.some((p) => /--gate/.test(p)));
  const noIsc = validateAdd({ card: 'X', gate: 'restart', criterion: 'c', why: 'w' });
  ok('a missing --isc is a WARNING, not a blocking problem', noIsc.problems.length === 0 && noIsc.warnings.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
