// Self-test for skill-resolver.mjs (FRW-BL-062). Run: node framework/agents/skill-resolver.test.mjs
import { loadContracts, resolveInputs, resolveSubSkillDeps } from './skill-resolver.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('skill-resolver self-test\n');

// --- loadContracts ------------------------------------------------------
ok('loadContracts returns the contracts map', (() => {
  const c = loadContracts({ contracts: { developer: { requiredSkills: [] } } });
  return c.developer && Array.isArray(c.developer.requiredSkills);
})());
ok('loadContracts returns {} when contracts absent', Object.keys(loadContracts({ name: 'core' })).length === 0);
ok('loadContracts returns {} for null/garbage', Object.keys(loadContracts(null)).length === 0 && Object.keys(loadContracts(42)).length === 0);

// --- resolveInputs ------------------------------------------------------
const devContract = {
  inputs: {
    DOMAIN: { type: 'string', required: true },
    MODEL: { type: 'string', default: 'sonnet-4' },
    CONSTRAINTS: { type: 'string', default: '' },
  },
};

const r1 = resolveInputs(devContract, { DOMAIN: 'backend' });
ok('resolveInputs fills defaults for absent inputs', r1.resolved.MODEL === 'sonnet-4' && r1.resolved.CONSTRAINTS === '');
ok('resolveInputs keeps provided values over defaults', resolveInputs(devContract, { DOMAIN: 'be', MODEL: 'opus' }).resolved.MODEL === 'opus');
ok('resolveInputs satisfies required when provided', r1.missingRequired.length === 0);

const r2 = resolveInputs(devContract, {});
ok('resolveInputs flags missing required input', r2.missingRequired.length === 1 && r2.missingRequired[0] === 'DOMAIN');
ok('resolveInputs still applies defaults when required is missing', r2.resolved.MODEL === 'sonnet-4');

ok('resolveInputs passes through undeclared provided values', resolveInputs(devContract, { DOMAIN: 'x', EXTRA: 1 }).resolved.EXTRA === 1);
ok('resolveInputs treats undefined-provided as absent (default applies)', resolveInputs(devContract, { DOMAIN: 'x', MODEL: undefined }).resolved.MODEL === 'sonnet-4');
ok('resolveInputs handles empty/missing contract gracefully', resolveInputs({}, {}).missingRequired.length === 0 && resolveInputs(undefined, undefined).missingRequired.length === 0);

// --- resolveSubSkillDeps: transitive + stable order ---------------------
const transitive = {
  developer: { requiredSkills: ['tdd', 'debug'] },
  tdd: { requiredSkills: ['fixtures'] },
  debug: { requiredSkills: [] },
  fixtures: { requiredSkills: [] },
};
const d1 = resolveSubSkillDeps('developer', transitive);
ok('resolveSubSkillDeps returns no cycle for a DAG', d1.cycle === null);
ok('resolveSubSkillDeps includes all transitive required skills', ['tdd', 'debug', 'fixtures'].every((s) => d1.skills.includes(s)));
ok('resolveSubSkillDeps excludes the root agentType', !d1.skills.includes('developer'));
// post-order, sibling order preserved: fixtures (dep of tdd) before tdd; debug after tdd.
ok('resolveSubSkillDeps emits deps before requirer (stable order)', JSON.stringify(d1.skills) === JSON.stringify(['fixtures', 'tdd', 'debug']));
// determinism: same input → same output
ok('resolveSubSkillDeps is deterministic', JSON.stringify(resolveSubSkillDeps('developer', transitive).skills) === JSON.stringify(d1.skills));

// shared transitive dep should appear once
const diamond = {
  a: { requiredSkills: ['b', 'c'] },
  b: { requiredSkills: ['d'] },
  c: { requiredSkills: ['d'] },
  d: { requiredSkills: [] },
};
const dd = resolveSubSkillDeps('a', diamond);
ok('resolveSubSkillDeps de-duplicates shared deps', dd.skills.filter((s) => s === 'd').length === 1);
ok('resolveSubSkillDeps diamond order is stable', JSON.stringify(dd.skills) === JSON.stringify(['d', 'b', 'c']));

// missing referenced contract treated as leaf, still included
const missingRef = { developer: { requiredSkills: ['ghost'] } };
ok('resolveSubSkillDeps includes missing-contract skills as leaves', JSON.stringify(resolveSubSkillDeps('developer', missingRef).skills) === JSON.stringify(['ghost']));

// no requiredSkills → empty, no cycle
ok('resolveSubSkillDeps with empty requiredSkills returns []', JSON.stringify(resolveSubSkillDeps('reviewer', { reviewer: { requiredSkills: [] } }).skills) === JSON.stringify([]));

// --- resolveSubSkillDeps: cycle detection -------------------------------
const cyclic = {
  a: { requiredSkills: ['b'] },
  b: { requiredSkills: ['c'] },
  c: { requiredSkills: ['a'] },
};
const cyc = resolveSubSkillDeps('a', cyclic);
ok('resolveSubSkillDeps detects a cycle (does not loop forever)', cyc.cycle !== null);
ok('resolveSubSkillDeps returns the cycle path', JSON.stringify(cyc.cycle) === JSON.stringify(['a', 'b', 'c', 'a']));
ok('resolveSubSkillDeps returns empty skills on cycle', JSON.stringify(cyc.skills) === JSON.stringify([]));

const selfLoop = { a: { requiredSkills: ['a'] } };
ok('resolveSubSkillDeps detects a self-loop', JSON.stringify(resolveSubSkillDeps('a', selfLoop).cycle) === JSON.stringify(['a', 'a']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
