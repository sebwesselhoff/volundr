// Self-test for verify-evidence.mjs (FRW-BL-086). Run: node scripts/verify-evidence.test.mjs
import { classifyCriterion, parseVerifyBlock, validateEntry, validateIsc } from './verify-evidence.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

console.log('verify-evidence self-test\n');

// --- classifyCriterion ---
ok('explicit requiresRuntime:true wins', classifyCriterion({ criterion: 'anything', requiresRuntime: true }).requiresRuntime);
ok('explicit requiresRuntime:false wins over a matching phrase',
  !classifyCriterion({ criterion: 'the test suite passes', requiresRuntime: false }).requiresRuntime);
ok('detects an execution-outcome criterion', classifyCriterion({ criterion: 'The self-test exits 0' }).requiresRuntime);
ok('detects a build criterion', classifyCriterion({ criterion: 'npx tsc --noEmit typecheck is clean' }).requiresRuntime);
ok('a purely documentary criterion is static',
  !classifyCriterion({ criterion: 'guardrails.md documents the pinned model id' }).requiresRuntime);
ok('a file-existence criterion is static',
  !classifyCriterion({ criterion: 'framework/tiers.mjs exists and exports TIER_ORDER' }).requiresRuntime);
ok('empty criterion is static', !classifyCriterion({ criterion: '' }).requiresRuntime);
ok('non-object is static and does not throw', !classifyCriterion(null).requiresRuntime);

// --- parseVerifyBlock ---
const GOOD = `Ran the suite.
VERIFY node scripts/foo.test.mjs
exit=0
12 passed, 0 failed
ran: this session`;

const b = parseVerifyBlock(GOOD);
ok('finds the block', b.found);
ok('extracts the command', b.command === 'node scripts/foo.test.mjs');
ok('extracts an integer exit code', b.exitCode === 0);
ok('collects output lines', b.output.includes('12 passed, 0 failed'));
ok('extracts the ran marker', b.ran === 'this session');

ok('bracketed command form is accepted', parseVerifyBlock('VERIFY [npm test]\nexit=0\nok\nran: now').command === 'npm test');
ok('fenced block is accepted', parseVerifyBlock('```\nVERIFY npm test\nexit=0\nok\nran: now\n```').found);
ok('no VERIFY line -> not found', !parseVerifyBlock('I ran it and it worked').found);
ok('empty evidence -> not found', !parseVerifyBlock('').found);
ok('non-string evidence -> not found', !parseVerifyBlock(undefined).found);
ok('a non-zero exit is captured, not swallowed', parseVerifyBlock('VERIFY x\nexit=1\nboom\nran: now').exitCode === 1);
ok('a malformed exit line is not counted as output',
  !parseVerifyBlock('VERIFY x\nexit=abc\nreal output\nran: now').output.includes('exit=abc'));

// --- validateEntry ---
const runtimeCriterion = 'The self-test exits 0';

ok('valid runtime evidence passes',
  validateEntry({ criterion: runtimeCriterion, passed: true, evidence: GOOD }).ok);

const noBlock = validateEntry({ criterion: runtimeCriterion, passed: true, evidence: 'I checked, it works' });
ok('runtime criterion with NO VERIFY block fails', !noBlock.ok);
ok('...and says why', /no VERIFY block/.test(noBlock.errors[0]));

const nonZero = validateEntry({
  criterion: runtimeCriterion, passed: true,
  evidence: 'VERIFY npm test\nexit=1\n3 failing\nran: this session',
});
ok('passed:true with a NON-ZERO exit fails', !nonZero.ok);
ok('...and reports the exit code', /exit=1/.test(nonZero.errors.join(' ')));

ok('missing exit line fails',
  !validateEntry({ criterion: runtimeCriterion, passed: true, evidence: 'VERIFY npm test\nsome output\nran: now' }).ok);
ok('missing output fails',
  !validateEntry({ criterion: runtimeCriterion, passed: true, evidence: 'VERIFY npm test\nexit=0\nran: now' }).ok);
ok('missing ran: marker fails',
  !validateEntry({ criterion: runtimeCriterion, passed: true, evidence: 'VERIFY npm test\nexit=0\nok' }).ok);
ok('missing command fails',
  !validateEntry({ criterion: runtimeCriterion, passed: true, evidence: 'VERIFY\nexit=0\nok\nran: now' }).ok);

// Staleness
const SESSION = '2d83c440-02a0-4c03-93f2-77edb827e341';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const staleEv = `VERIFY npm test\nexit=0\nok\nran: ${OTHER}`;
const freshEv = `VERIFY npm test\nexit=0\nok\nran: ${SESSION}`;
ok('evidence from ANOTHER session is rejected as stale',
  !validateEntry({ criterion: runtimeCriterion, passed: true, evidence: staleEv }, { sessionId: SESSION }).ok);
ok('...with a stale-specific message',
  /STALE/.test(validateEntry({ criterion: runtimeCriterion, passed: true, evidence: staleEv }, { sessionId: SESSION }).errors.join(' ')));
ok('evidence from the CURRENT session is accepted',
  validateEntry({ criterion: runtimeCriterion, passed: true, evidence: freshEv }, { sessionId: SESSION }).ok);
ok('"this session" is accepted when no id is embedded',
  validateEntry({ criterion: runtimeCriterion, passed: true, evidence: GOOD }, { sessionId: SESSION }).ok);
ok('staleness is not checked when no sessionId is supplied',
  validateEntry({ criterion: runtimeCriterion, passed: true, evidence: staleEv }).ok);

// Skips
ok('a criterion not marked passed:true is skipped (the done-gate owns that)',
  validateEntry({ criterion: runtimeCriterion, passed: false, evidence: '' }).skipped);
ok('a static criterion is skipped even with no evidence',
  validateEntry({ criterion: 'the doc mentions X', passed: true, evidence: '' }).skipped);

// --- validateIsc ---
ok('null ISC is exempt (backward compat, matches the API gate)', validateIsc(null).ok);
ok('empty array is fine', validateIsc([]).ok);
ok('a non-array ISC FAILS CLOSED', !validateIsc('nope').ok);
ok('an entry that is not an object FAILS CLOSED', !validateIsc([42]).ok);

const mixed = validateIsc([
  { criterion: 'doc says X', passed: true, evidence: 'see line 12' },
  { criterion: runtimeCriterion, passed: true, evidence: GOOD },
  { criterion: 'the build passes', passed: true, evidence: 'looks fine to me' },
]);
ok('mixed ISC reports exactly the one bad runtime entry', !mixed.ok && mixed.errors.length === 1, JSON.stringify(mixed.errors));
ok('mixed ISC counts skips and checks', mixed.skipped === 1 && mixed.checked === 2, `skipped=${mixed.skipped} checked=${mixed.checked}`);

const allGood = validateIsc([
  { criterion: 'doc says X', passed: true, evidence: 'line 12' },
  { criterion: runtimeCriterion, passed: true, evidence: freshEv },
], { sessionId: SESSION });
ok('a fully valid ISC passes', allGood.ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
