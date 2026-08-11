// Self-test for tiers.mjs (FRW-BL-085). Run: node framework/tiers.test.mjs
//
// Guards the single tier encoding and, critically, its agreement with hierarchy-config.ts —
// the one gap an `import` cannot close, because the .ts source needs a toolchain this repo
// deliberately does not carry in a worktree. So we read it as TEXT and compare.

import { readFileSync } from 'fs';
import { TIER_ORDER, TIER_ORDER_DESC, FLOOR_TIER, CEIL_TIER, tierRank } from './tiers.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

console.log('tiers self-test\n');

// --- shape ---
ok('TIER_ORDER is low->high haiku,sonnet,opus', JSON.stringify(TIER_ORDER) === JSON.stringify(['haiku', 'sonnet', 'opus']));
ok('TIER_ORDER is frozen', Object.isFrozen(TIER_ORDER));
ok('TIER_ORDER_DESC is high->low opus,sonnet,haiku', JSON.stringify(TIER_ORDER_DESC) === JSON.stringify(['opus', 'sonnet', 'haiku']));
ok('TIER_ORDER_DESC is frozen', Object.isFrozen(TIER_ORDER_DESC));

// DESC must be DERIVED, not a second literal — that is the whole point of the card.
ok(
  'TIER_ORDER_DESC is exactly TIER_ORDER reversed (derived, cannot drift)',
  JSON.stringify(TIER_ORDER_DESC) === JSON.stringify([...TIER_ORDER].reverse())
);
ok('reversing DESC round-trips to TIER_ORDER', JSON.stringify([...TIER_ORDER_DESC].reverse()) === JSON.stringify([...TIER_ORDER]));

// --- clamps + rank ---
ok('FLOOR_TIER is the cheapest tier', FLOOR_TIER === 'haiku');
ok('CEIL_TIER is the most capable tier', CEIL_TIER === 'opus');
ok('tierRank is ascending by capability', tierRank('haiku') === 0 && tierRank('sonnet') === 1 && tierRank('opus') === 2);
ok('tierRank returns -1 for an unknown tier', tierRank('gpt') === -1);
ok('tierRank tolerates non-string input', tierRank(undefined) === -1 && tierRank(null) === -1);

// --- parity with hierarchy-config.ts (the import-proof gap) ---
const tsSrc = readFileSync(new URL('./hierarchy-config.ts', import.meta.url), 'utf8');
const m = tsSrc.match(/tierOrder:\s*\[([^\]]*)\]/);
ok('hierarchy-config.ts declares an escalation tierOrder', !!m, 'no `tierOrder: [...]` found — did the config move?');

if (m) {
  const tsOrder = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  ok(
    'tiers.mjs TIER_ORDER matches hierarchy-config.ts tierOrder EXACTLY',
    JSON.stringify(tsOrder) === JSON.stringify([...TIER_ORDER]),
    `hierarchy-config.ts=${JSON.stringify(tsOrder)} tiers.mjs=${JSON.stringify([...TIER_ORDER])}`
  );
}

// --- the consumers must all trace back to this module, with no local literals ---
const consumers = [
  ['framework/scenario-router.mjs', '../framework/scenario-router.mjs'],
  ['framework/workflow-model.mjs', '../framework/workflow-model.mjs'],
  ['scripts/budget-controller.mjs', '../scripts/budget-controller.mjs'],
];
for (const [label, rel] of consumers) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  ok(`${label} imports from tiers.mjs`, /from\s+['"][^'"]*tiers\.mjs['"]/.test(src));
  ok(
    `${label} declares no local tier literal`,
    !/Object\.freeze\(\[\s*['"](?:haiku|opus)['"]\s*,/.test(src),
    'a re-introduced local literal is exactly the drift this card removed'
  );
}

// --- and the live consumers still expose the direction their callers expect ---
const [{ TIER_ORDER: routerOrder }, { TIER_ORDER: wfOrder }, { TIER_ORDER: budgetOrder }] = await Promise.all([
  import('./scenario-router.mjs'),
  import('./workflow-model.mjs'),
  import('../scripts/budget-controller.mjs'),
]);
ok('scenario-router still exports ascending order', JSON.stringify(routerOrder) === JSON.stringify(['haiku', 'sonnet', 'opus']));
ok('workflow-model still exports ascending order', JSON.stringify(wfOrder) === JSON.stringify(['haiku', 'sonnet', 'opus']));
ok('budget-controller still exports DESCENDING order (its downgrade ladder)', JSON.stringify(budgetOrder) === JSON.stringify(['opus', 'sonnet', 'haiku']));
ok('the two directions are genuinely opposite', JSON.stringify(routerOrder) === JSON.stringify([...budgetOrder].reverse()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
