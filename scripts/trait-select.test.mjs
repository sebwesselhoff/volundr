// trait-select.test.mjs — self-test for the FRW-BL-110 trait-injection rules.
// Run: node scripts/trait-select.test.mjs
// Deterministic, no network. The live-repo assertions read framework/agents/traits.yaml directly,
// because a vocabulary that parses in a fixture but not in the real file is worthless.

import { readFileSync } from 'fs';
import {
  parseVocabulary, selectTraits, unknownTraitRefs, TRAIT_BUDGET, RESERVED_KEYS,
} from './trait-select.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ok ${label}`); } else { fail++; console.log(`  FAIL ${label}`); } };

const repoRoot = new URL('..', import.meta.url);
const liveYaml = readFileSync(new URL('framework/agents/traits.yaml', repoRoot), 'utf8');
const live = parseVocabulary(liveYaml);

console.log('trait-select self-test\n');

// --- the live vocabulary ------------------------------------------------------
{
  ok(`the live traits.yaml parses with no errors${live.errors.length ? ` (${live.errors[0]})` : ''}`,
    live.errors.length === 0);
  ok('the three harvested traits are present (FRW-BL-110 ISC-1)',
    ['determinism-first', 'trade-off-explicit', 'causal-rigor'].every((t) => live.traits.has(t)));
  ok('all three landed under `approach`, not a new category',
    ['determinism-first', 'trade-off-explicit', 'causal-rigor'].every((t) => live.traits.get(t) === 'approach'));
  ok('the pre-existing vocabulary is intact',
    ['security', 'performance', 'thorough', 'pragmatic', 'cautious', 'fast', 'frontend', 'backend', 'infra']
      .every((t) => live.traits.has(t)));
  ok('threat-modeling was MERGED into security, not added as a competing trait (ISC-2)',
    !live.traits.has('threat-modeling') && /name the adversary/i.test(liveYaml));
  ok('every registry defaultTraits reference resolves to a real trait',
    unknownTraitRefs(
      readFileSync(new URL('framework/agents/registry.data.mjs', repoRoot), 'utf8'),
      live.traits,
    ).length === 0);
}

// --- the provenance block must not become a phantom category ------------------
{
  ok('`provenance` is a reserved key, not a trait category', RESERVED_KEYS.has('provenance'));
  ok('the live file has exactly the three real categories despite carrying provenance',
    Object.keys(live.categories).sort().join(',') === 'approach,domain,expertise');
  ok('no provenance field leaked in as a selectable trait',
    !live.traits.has('source') && !live.traits.has('commit') && !live.traits.has('reviewer'));
}

// --- ISC-5: budget and dedup, exercised with a NEW trait ----------------------
{
  // The realistic shape: the same trait arrives from a card signal AND as a registry default.
  const sources = [
    { origin: 'card-signals', traits: ['causal-rigor'] },
    { origin: 'project-constraints', traits: ['determinism-first'] },
    { origin: 'steering-rules', traits: ['security'] },
    { origin: 'registry-defaults', traits: ['causal-rigor', 'thorough'] },
  ];
  const r = selectTraits(sources, { available: live.traits });
  ok('a new trait is actually injected (ISC-5)', r.selected.includes('causal-rigor'));
  ok('the duplicate is collapsed, not injected twice',
    r.selected.filter((t) => t === 'causal-rigor').length === 1);
  ok('FIRST occurrence wins — the card signal keeps it, not the registry default',
    r.duplicates.length === 1 && r.duplicates[0].keptFrom === 'card-signals' && r.duplicates[0].origin === 'registry-defaults');
  ok('the surviving set is within budget', r.selected.length <= TRAIT_BUDGET);
  ok('no errors for a well-formed selection', r.errors.length === 0);
  ok('source order is preserved in the output', r.selected[0] === 'causal-rigor' && r.selected[1] === 'determinism-first');
}

{
  // Over budget: the tail is dropped and REPORTED. Silent truncation would let a registry default
  // push out a card-signalled trait with nobody the wiser.
  const many = [
    { origin: 'card-signals', traits: ['causal-rigor', 'determinism-first', 'trade-off-explicit'] },
    { origin: 'registry-defaults', traits: ['security', 'thorough', 'pragmatic', 'cautious'] },
  ];
  const r = selectTraits(many, { available: live.traits });
  ok('the budget of 5 is enforced', r.selected.length === TRAIT_BUDGET);
  ok('over-budget traits are dropped from the TAIL, so card signals survive',
    r.selected.includes('causal-rigor') && r.selected.includes('determinism-first') && r.selected.includes('trade-off-explicit'));
  ok('drops are REPORTED, not silent', r.dropped.length === 2 && r.dropped.every((d) => /budget/.test(d.reason)));
  ok('the drop names which trait and where it came from',
    r.dropped[0].trait === 'pragmatic' && r.dropped[0].origin === 'registry-defaults');
  ok('a custom budget is respected', selectTraits(many, { available: live.traits, budget: 2 }).selected.length === 2);
}

// --- ways this could be quietly wrong ----------------------------------------
{
  const r = selectTraits([{ origin: 'card-signals', traits: ['no-such-trait'] }], { available: live.traits });
  ok('an unknown trait is an ERROR, not silently injected',
    r.errors.length === 1 && /unknown trait "no-such-trait"/.test(r.errors[0]));
  ok('the unknown-trait error names the source that asked for it', /card-signals/.test(r.errors[0]));
  ok('and it is NOT added to the selection', r.selected.length === 0);
  ok('without an `available` set, no validation is attempted (opt-in)',
    selectTraits([{ origin: 'x', traits: ['anything'] }]).selected.length === 1);
}
{
  ok('empty sources yield an empty selection', selectTraits([]).selected.length === 0);
  ok('null/undefined do not throw',
    selectTraits(null).selected.length === 0 && selectTraits(undefined).errors.length === 0);
  ok('a malformed source entry does not throw',
    selectTraits([null, { origin: 'a' }, { traits: null }]).selected.length === 0);
  ok('blank and non-string trait names are skipped',
    selectTraits([{ origin: 'a', traits: ['', '   ', 42, null, 'thorough'] }], { available: live.traits }).selected.length === 1);
  ok('surrounding whitespace is trimmed so " thorough" is the same trait as "thorough"',
    selectTraits([{ origin: 'a', traits: [' thorough'] }, { origin: 'b', traits: ['thorough'] }],
      { available: live.traits }).selected.length === 1);
}
{
  // A trait with no inject: body would consume a budget slot and inject nothing — silently
  // weakening every prompt that selects it.
  const hollow = 'approach:\n  hollow:\n  real:\n    inject: |\n      Do a thing.\n';
  const v = parseVocabulary(hollow);
  ok('a trait with no inject body is reported', v.errors.some((e) => /has no inject/.test(e)));
  ok('the well-formed sibling still parses', v.traits.has('real'));

  const dupe = 'approach:\n  x:\n    inject: |\n      one\n  x:\n    inject: |\n      two\n';
  ok('a trait defined twice is reported (the second silently wins otherwise)',
    parseVocabulary(dupe).errors.some((e) => /defined twice/.test(e)));

  ok('an empty vocabulary is reported rather than accepted',
    parseVocabulary('').errors.some((e) => /vocabulary is empty|no traits parsed/.test(e)));
  ok('garbage does not throw', parseVocabulary(null).traits.size === 0);
  ok('comments are ignored', parseVocabulary('# approach:\napproach:\n  a:\n    inject: |\n      x\n').traits.size === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
