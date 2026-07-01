// Self-test for model-resolution.ts (FRW-BL-077). Imports the real TS modules (pulls in
// hierarchy-config.ts MODEL_TIERS), so run it with tsx:  npx tsx framework/model-resolution.test.ts
// Not wired into CI (framework/*.ts are reference modules, like scenario-router.test.mjs is run by
// hand); it is the reproducible backing for the card's behavioral verification + a regression guard.
import {
  resolveModelForAgentType, resolveModel, stepDownTier, baseTierForAgentType, NON_DOWNGRADABLE_ROLES,
} from './model-resolution.js';

let pass = 0, fail = 0;
function ok(l: string, c: boolean) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } }

console.log('model-resolution self-test (FRW-BL-077)\n');

// --- volundr lead exempt ---------------------------------------------------------------------
ok('volundr normal -> opus', resolveModelForAgentType('volundr') === 'opus');
ok('volundr economy -> opus (never downgraded)', resolveModelForAgentType('volundr', true) === 'opus');
ok('NON_DOWNGRADABLE_ROLES is exactly {volundr}', NON_DOWNGRADABLE_ROLES.has('volundr') && NON_DOWNGRADABLE_ROLES.size === 1);

// --- standard (sonnet) roles step down to haiku under economy --------------------------------
for (const r of ['developer', 'architect', 'qa-engineer', 'devops-engineer', 'designer', 'reviewer', 'guardian', 'researcher', 'tester', 'planner']) {
  ok(`${r} normal -> sonnet`, resolveModelForAgentType(r) === 'sonnet');
  ok(`${r} economy -> haiku`, resolveModelForAgentType(r, true) === 'haiku');
}

// --- haiku-floor roles unchanged (correcting the old model-resolution which claimed sonnet) ----
ok('fixer normal -> haiku', resolveModelForAgentType('fixer') === 'haiku');
ok('fixer economy -> haiku (floor)', resolveModelForAgentType('fixer', true) === 'haiku');
ok('content normal -> haiku', resolveModelForAgentType('content') === 'haiku');
ok('content economy -> haiku (floor)', resolveModelForAgentType('content', true) === 'haiku');

// --- totality: unknown roles, overrides --------------------------------------------------------
ok('unknown role -> sonnet (default tier)', resolveModelForAgentType('does-not-exist') === 'sonnet');
ok('unknown role economy -> haiku', resolveModelForAgentType('does-not-exist', true) === 'haiku');
ok('explicit override wins verbatim (normal)', resolveModelForAgentType('developer', false, 'opus') === 'opus');
ok('explicit override wins verbatim + not downgraded (economy)', resolveModelForAgentType('developer', true, 'opus') === 'opus');
ok('empty-string override ignored -> base', resolveModelForAgentType('developer', false, '') === 'sonnet');
ok('baseTierForAgentType(planner) -> sonnet', baseTierForAgentType('planner') === 'sonnet');

// --- prototype-key hardening (adversarial finding, FRW-BL-077 verify) --------------------------
// A role/tier named after an Object.prototype member must NOT leak an inherited function/object.
for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
  ok(`proto-key role "${bad}" -> sonnet (no leak)`, resolveModelForAgentType(bad) === 'sonnet');
  ok(`proto-key role "${bad}" economy -> haiku`, resolveModelForAgentType(bad, true) === 'haiku');
  ok(`baseTierForAgentType("${bad}") -> sonnet`, baseTierForAgentType(bad) === 'sonnet');
}

// --- stepDownTier ladder -----------------------------------------------------------------------
ok('stepDown opus -> sonnet', stepDownTier('opus') === 'sonnet');
ok('stepDown sonnet -> haiku', stepDownTier('sonnet') === 'haiku');
ok('stepDown haiku -> haiku (floor)', stepDownTier('haiku') === 'haiku');
ok('stepDown unknown tier -> passthrough (no invented tier)', stepDownTier('weird') === 'weird');
ok('resolveModel(sonnet, economy) -> haiku', resolveModel('sonnet', true) === 'haiku');

// --- every resolved value is a bare alias (no version pin) -------------------------------------
const alias = /^(haiku|sonnet|opus)$/;
ok('all resolved values are bare aliases (no version)',
  ['volundr', 'developer', 'architect', 'fixer', 'content', 'planner', 'constructor', 'toString'].every(
    (r) => alias.test(resolveModelForAgentType(r)) && alias.test(resolveModelForAgentType(r, true))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
