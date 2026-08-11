// Self-test for task-completed.js: quality-gate variable scoping.
//
// Regression guard for the `match` ReferenceError: `match` was declared with
// `const` INSIDE `if (Array.isArray(qualityRows)) { ... }` but dereferenced
// after the block closes, when building the quality payload for the
// `PATCH /api/cards/:id {status:'done'}` call. Because the declaration was
// block-scoped, EVERY card completion threw
//   ReferenceError: match is not defined
// before the PATCH ran — on both the array and the non-array (dashboard-down)
// path. The primary TaskCompleted completion path could not succeed, and
// quality scores never reached the API.
//
// The hook needs a live API + stdin to run end-to-end, so this test guards the
// invariant structurally (which is what would have caught the original bug) and
// then proves the scoping semantics that make the invariant load-bearing.
//
// Run: node task-completed.test.js  — exits 0 on success, 1 on any failure.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'task-completed.js'), 'utf8');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

console.log('task-completed.js — quality-gate scoping');

// --- Structural invariant -------------------------------------------------
// `match` must be declared at function scope, before the gate block, because
// the quality payload reads it after that block closes.

const gateOpenIdx = src.indexOf('if (Array.isArray(qualityRows))');
const payloadIdx = src.indexOf('const qualityObj = match');

ok('gate block is present', gateOpenIdx !== -1);
ok('quality payload still reads `match` after the gate', payloadIdx !== -1);

if (gateOpenIdx !== -1 && payloadIdx !== -1) {
  ok(
    'payload reads `match` AFTER the gate block opens (ordering assumption holds)',
    payloadIdx > gateOpenIdx
  );

  const beforeGate = src.slice(0, gateOpenIdx);
  const insideAndAfter = src.slice(gateOpenIdx, payloadIdx);

  // The declaration must sit ahead of the gate...
  ok(
    '`match` is declared at function scope before the gate block',
    /\blet\s+match\b/.test(beforeGate),
    'expected a `let match;` declaration before `if (Array.isArray(qualityRows))`'
  );

  // ...and must NOT be re-declared inside it (that is the original bug).
  ok(
    '`match` is NOT block-scoped inside the gate (const/let re-declaration)',
    !/\b(const|let)\s+match\b/.test(insideAndAfter),
    'a `const match` / `let match` inside the gate block re-introduces the ReferenceError'
  );

  // It must still be assigned inside the gate, or the gate does nothing.
  ok(
    '`match` is assigned inside the gate block',
    /^\s*match\s*=/m.test(insideAndAfter),
    'expected a bare `match = ...` assignment inside the gate'
  );
}

// --- Semantics ------------------------------------------------------------
// Why the invariant matters: reproduce both shapes in isolation. The broken
// shape must throw on BOTH payload shapes; the fixed shape must not.

function brokenShape(qualityRows) {
  if (Array.isArray(qualityRows)) {
    const cardRows = qualityRows.filter((r) => r.cardId === 'CARD-X');
    const match = cardRows.find((r) => r.reviewType === 'reviewer') || cardRows[0];
    if (!match) return { blocked: true };
  }
  // Bare dereference, exactly as the original source did. NOTE: a `typeof match`
  // guard here would NOT throw (typeof tolerates undeclared identifiers) and
  // would silently defeat this demonstration.
  // eslint-disable-next-line no-undef
  return { quality: match ? { c: match.completeness } : undefined };
}

function fixedShape(qualityRows) {
  let match;
  if (Array.isArray(qualityRows)) {
    const cardRows = qualityRows.filter((r) => r.cardId === 'CARD-X');
    match = cardRows.find((r) => r.reviewType === 'reviewer') || cardRows[0];
    if (!match) return { blocked: true };
  }
  return { quality: match ? { c: match.completeness } : undefined };
}

const scored = [{ cardId: 'CARD-X', reviewType: 'reviewer', completeness: 9 }];

function throwsReferenceError(fn, arg) {
  try {
    fn(arg);
    return false;
  } catch (e) {
    return e instanceof ReferenceError;
  }
}

ok(
  'broken shape throws ReferenceError on the scored path',
  throwsReferenceError(brokenShape, scored)
);
ok(
  'broken shape throws ReferenceError on the dashboard-down path',
  throwsReferenceError(brokenShape, null)
);
ok('fixed shape survives the scored path', !throwsReferenceError(fixedShape, scored));
ok('fixed shape survives the dashboard-down path', !throwsReferenceError(fixedShape, null));

// The fix must preserve behaviour, not just stop throwing.
const scoredResult = fixedShape(scored);
ok(
  'fixed shape carries the quality payload through when a score exists',
  scoredResult.quality && scoredResult.quality.c === 9,
  `got ${JSON.stringify(scoredResult)}`
);

const downResult = fixedShape(null);
ok(
  'fixed shape omits quality (does not fabricate it) when the dashboard is unreachable',
  downResult.quality === undefined,
  `got ${JSON.stringify(downResult)}`
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
