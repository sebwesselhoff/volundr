// Self-test for scenario-router.mjs (FRW-BL-059). Run: node framework/scenario-router.test.mjs
import {
  TIER_ORDER,
  SCENARIO_SIGNALS,
  DEFAULTS,
  classifyScenario,
  routeTier,
  createRouter,
} from './scenario-router.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('scenario-router self-test\n');

// --- exports / constants ---------------------------------------------------------------------
ok('TIER_ORDER is LOW->HIGH haiku,sonnet,opus', JSON.stringify(TIER_ORDER) === JSON.stringify(['haiku', 'sonnet', 'opus']));
ok('TIER_ORDER frozen', Object.isFrozen(TIER_ORDER));
ok('SCENARIO_SIGNALS exports the three signals', SCENARIO_SIGNALS.BACKGROUND === 'background' && SCENARIO_SIGNALS.THINK === 'think' && SCENARIO_SIGNALS.LONG_CONTEXT === 'long_context');
ok('SCENARIO_SIGNALS frozen', Object.isFrozen(SCENARIO_SIGNALS));
ok('DEFAULTS exposes token thresholds', DEFAULTS.thresholds.tokenHigh > DEFAULTS.thresholds.tokenLow && DEFAULTS.thresholds.tokenLow > 0);

// --- classifyScenario: detects each signal + none when absent --------------------------------
ok('detects background from explicit scenario field', JSON.stringify(classifyScenario({ scenario: 'background' })) === JSON.stringify(['background']));
ok('detects think from explicit array', classifyScenario({ scenario: ['think'] }).includes('think'));
ok('detects long_context from explicit array', classifyScenario({ scenario: ['long_context'] }).includes('long_context'));
// Positive keyword tests — use the precise, tightened phrasings required after the fix:
ok('detects background from "background job" phrase', classifyScenario({ description: 'Run this as a background job nightly.' }).includes('background'));
ok('detects background from "background task" phrase', classifyScenario({ description: 'This is a background task triggered by a queue.' }).includes('background'));
ok('detects background from "async job" phrase', classifyScenario({ description: 'Schedule as an async job.' }).includes('background'));
ok('detects think from "extended reasoning" phrase', classifyScenario({ technicalNotes: 'Needs extended reasoning to solve this.' }).includes('think'));
ok('detects think from "chain of thought" phrase', classifyScenario({ description: 'Use chain of thought to derive the answer.' }).includes('think'));
ok('detects think from "step by step" phrase', classifyScenario({ technicalNotes: 'Work through it step by step.' }).includes('think'));
ok('detects long_context from "entire codebase" phrase', classifyScenario({ title: 'Refactor across the entire codebase' }).includes('long_context'));
ok('detects long_context from "many files" phrase', classifyScenario({ description: 'This touches many files across the project.' }).includes('long_context'));
ok('detects long_context from "long context" phrase', classifyScenario({ technicalNotes: 'Requires a long context window.' }).includes('long_context'));
ok('detects MULTIPLE signals at once', (() => { const s = classifyScenario({ description: 'background task', technicalNotes: 'long context, many files', scenario: 'think' }); return s.includes('background') && s.includes('think') && s.includes('long_context'); })());
ok('NONE detected when absent (empty array)', JSON.stringify(classifyScenario({ title: 'Add a button', description: 'Make the login button blue.' })) === JSON.stringify([]));
ok('NONE for empty/undefined card', classifyScenario().length === 0 && classifyScenario({}).length === 0);
ok('explicit unknown signal is ignored (no invented signal)', classifyScenario({ scenario: ['turbo', 'background'] }).every((s) => s === 'background') && classifyScenario({ scenario: 'turbo' }).length === 0);
ok('output de-duplicated + canonical order', JSON.stringify(classifyScenario({ scenario: ['think', 'background', 'think'], description: 'long context' })) === JSON.stringify(['background', 'think', 'long_context']));

// --- NEGATIVE-SIGNAL REGRESSION TESTS: ordinary prose must NEVER trigger a signal -----------
// These are the exact false-positive cases the keyword tightening was designed to prevent.
ok('NEG: "Set the background color" must NOT trigger background signal', classifyScenario({ description: 'Set the background color to #fff.' }).length === 0);
ok('NEG: "background image on the login page" must NOT trigger background signal', classifyScenario({ description: 'There is a background image on the login page.' }).length === 0);
ok('NEG: "I think this works" must NOT trigger think signal', classifyScenario({ description: 'I think this implementation is correct.' }).length === 0);
ok('NEG: "rethink the API surface" must NOT trigger think signal', classifyScenario({ title: 'Rethink the API surface for v2' }).length === 0);
ok('NEG: "unthinkable" must NOT trigger think signal', classifyScenario({ description: 'Losing data would be unthinkable.' }).length === 0);
ok('NEG: "this has massive impact" must NOT trigger long_context signal', classifyScenario({ description: 'This change has massive impact on performance.' }).length === 0);
ok('NEG: "massive user base" must NOT trigger long_context signal', classifyScenario({ title: 'Support a massive user base' }).length === 0);
ok('NEG: "large input validation" must NOT trigger long_context (bare "large input" removed)', classifyScenario({ description: 'Add large input validation to the form.' }).length === 0);
ok('NEG: "thinking about the architecture" must NOT trigger think signal', classifyScenario({ description: 'I was thinking about the architecture.' }).length === 0);
ok('NEG: card with NO matching fields returns EXACTLY [] (default unchanged at classifyScenario level)', JSON.stringify(classifyScenario({ title: 'Fix typo in README', description: 'One word.' })) === JSON.stringify([]));

// --- routeTier: escalation on long_context / high token count --------------------------------
ok('long_context escalates sonnet -> opus', routeTier({ baseTier: 'sonnet', scenario: ['long_context'] }) === 'opus');
ok('long_context lifts haiku to at-least-sonnet then +1 -> opus', routeTier({ baseTier: 'haiku', scenario: ['long_context'] }) === 'opus');
ok('high token count escalates even with NO signal', routeTier({ baseTier: 'sonnet', tokenCount: DEFAULTS.thresholds.tokenHigh }) === 'opus');
ok('token count below tokenHigh does NOT escalate', routeTier({ baseTier: 'sonnet', tokenCount: DEFAULTS.thresholds.tokenHigh - 1 }) === 'sonnet');
ok('think escalates haiku -> sonnet', routeTier({ baseTier: 'haiku', scenario: ['think'] }) === 'sonnet');
ok('think escalates sonnet -> opus', routeTier({ baseTier: 'sonnet', scenario: ['think'] }) === 'opus');
ok('escalation clamps at opus', routeTier({ baseTier: 'opus', scenario: ['long_context', 'think'], tokenCount: 500000 }) === 'opus');
ok('background + small request downgrades sonnet -> haiku', routeTier({ baseTier: 'sonnet', scenario: ['background'], tokenCount: 100 }) === 'haiku');
ok('background downgrade clamps at haiku floor', routeTier({ baseTier: 'haiku', scenario: ['background'], tokenCount: 100 }) === 'haiku');
ok('background does NOT downgrade a large request', routeTier({ baseTier: 'sonnet', scenario: ['background'], tokenCount: DEFAULTS.thresholds.tokenLow }) === 'sonnet');
ok('background never undoes an escalation (long_context wins)', routeTier({ baseTier: 'sonnet', scenario: ['background', 'long_context'], tokenCount: 100 }) === 'opus');

// --- routeTier: DEFAULT UNCHANGED (ISC-3) — no signals + no override + low tokens ------------
for (const base of ['haiku', 'sonnet', 'opus']) {
  ok(`DEFAULT unchanged: baseTier '${base}' returned EXACTLY (no signals, low tokens, no override)`,
    routeTier({ baseTier: base }) === base &&
    routeTier({ baseTier: base, scenario: [], tokenCount: 0 }) === base &&
    routeTier({ baseTier: base, scenario: [], tokenCount: DEFAULTS.thresholds.tokenLow - 1 }) === base);
}
ok('DEFAULT unchanged: omitted baseTier falls to sonnet and stays', routeTier({}) === 'sonnet' && routeTier() === 'sonnet');
ok('DEFAULT unchanged: even an UNKNOWN baseTier passes through verbatim when nothing fires', routeTier({ baseTier: 'gpt-5' }) === 'gpt-5');

// --- routeTier: override function takes precedence (per card/agent) ---------------------------
ok('override WINS over base tier when it returns a valid tier', routeTier({ baseTier: 'haiku', override: () => 'opus' }) === 'opus');
ok('override WINS even over rule-based escalation', routeTier({ baseTier: 'sonnet', scenario: ['long_context'], tokenCount: 999999, override: () => 'haiku' }) === 'haiku');
ok('override receives the full context', (() => { let seen = null; routeTier({ baseTier: 'sonnet', scenario: ['think'], tokenCount: 42, override: (ctx) => { seen = ctx; return 'opus'; } }); return seen && seen.baseTier === 'sonnet' && seen.scenario.includes('think') && seen.tokenCount === 42 && seen.thresholds.tokenHigh === DEFAULTS.thresholds.tokenHigh; })());
ok('override can force a downgrade per card', routeTier({ baseTier: 'opus', override: () => 'haiku' }) === 'haiku');

// --- routeTier: invalid override falls back to rule-based (no crash) -------------------------
ok('override returning unknown tier -> falls back to rules (escalates)', routeTier({ baseTier: 'sonnet', scenario: ['long_context'], override: () => 'banana' }) === 'opus');
ok('override returning undefined -> falls back to default-unchanged', routeTier({ baseTier: 'sonnet', override: () => undefined }) === 'sonnet');
ok('override returning null -> falls back', routeTier({ baseTier: 'opus', override: () => null }) === 'opus');
ok('override that THROWS does not crash -> falls back to rules', routeTier({ baseTier: 'haiku', scenario: ['think'], override: () => { throw new Error('boom'); } }) === 'sonnet');
ok('non-function override is ignored (default unchanged)', routeTier({ baseTier: 'sonnet', override: 'opus' }) === 'sonnet');

// --- createRouter: binds an override hook, route() wraps routeTier ----------------------------
{
  const r = createRouter({ overrideHook: (ctx) => (ctx.scenario.includes('background') ? 'haiku' : undefined) });
  ok('createRouter returns { route }', typeof r.route === 'function');
  ok('bound hook applies when it returns a tier', r.route({ baseTier: 'opus', scenario: ['background'] }) === 'haiku');
  ok('bound hook returning undefined -> rule-based path', r.route({ baseTier: 'sonnet', scenario: ['think'] }) === 'opus');
  ok('bound hook + no signals -> default unchanged', r.route({ baseTier: 'sonnet' }) === 'sonnet');

  const r2 = createRouter(); // no hook at all
  ok('createRouter with no hook behaves like plain routeTier (default unchanged)', r2.route({ baseTier: 'haiku' }) === 'haiku');
  ok('createRouter with no hook still applies rules', r2.route({ baseTier: 'sonnet', scenario: ['long_context'] }) === 'opus');

  // Per-call override beats the bound hook (per card/agent control).
  ok('per-call override beats the bound hook', r.route({ baseTier: 'sonnet', scenario: ['background'], override: () => 'opus' }) === 'opus');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
