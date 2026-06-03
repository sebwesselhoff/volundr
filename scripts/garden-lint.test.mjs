// Self-test for garden-lint.mjs (FRW-BL-067). Run: node scripts/garden-lint.test.mjs
import { extractRegistryRefs, sizeViolations, MD_BYTE_CAP } from './garden-lint.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('garden-lint self-test\n');

const sample = `
  developer: {
    promptTemplate: 'framework/packs/core/prompts/developer-teammate.md',
    personaTemplate: 'fullstack-web',
    pack: 'core',
  },
  guardian: {
    promptTemplate: 'framework/packs/quality/prompts/guardian-teammate.md',
    personaTemplate: 'security-reviewer',
    pack: 'quality',
  },
`;
const refs = extractRegistryRefs(sample);
ok('extracts promptTemplates', refs.promptTemplates.length === 2 && refs.promptTemplates[0].endsWith('developer-teammate.md'));
ok('extracts personaTemplates', refs.personaTemplates.includes('fullstack-web') && refs.personaTemplates.includes('security-reviewer'));
ok('extracts packs (deduped)', refs.packs.length === 2 && refs.packs.includes('core') && refs.packs.includes('quality'));

const dedupSample = `pack: 'quality',\npack: 'quality',\npack: 'core',`;
ok('dedupes repeated packs', extractRegistryRefs(dedupSample).packs.length === 2);

ok('empty source → empty refs', extractRegistryRefs('').promptTemplates.length === 0);

// sizeViolations
const files = [
  { path: 'a.md', bytes: 100 },
  { path: 'big.md', bytes: MD_BYTE_CAP + 1 },
  { path: 'exact.md', bytes: MD_BYTE_CAP },
];
const v = sizeViolations(files);
ok('flags only over-cap files', v.length === 1 && v[0].path === 'big.md');
ok('at-cap is NOT a violation (strictly greater)', !v.some(f => f.path === 'exact.md'));
ok('custom cap respected', sizeViolations(files, 50).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
