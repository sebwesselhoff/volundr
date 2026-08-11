// Self-test for garden-lint.mjs (FRW-BL-067). Run: node scripts/garden-lint.test.mjs
import { readFileSync } from 'fs';
import { extractRegistryRefs, sizeViolations, pinDrift, MD_BYTE_CAP } from './garden-lint.mjs';

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

// --- pinDrift (FRW-BL-082) -------------------------------------------------
// Couples .claude/settings.json model pins to their guardrails.md ISC-3 contract.

const GOOD_SETTINGS = JSON.stringify({
  env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' },
});
const GOOD_GUARDRAILS = `
## ISC-3: Pinned Default Model IDs
| \`ANTHROPIC_DEFAULT_OPUS_MODEL\` | \`claude-opus-5\` | High-capability |
| \`ANTHROPIC_DEFAULT_SONNET_MODEL\` | \`claude-sonnet-5\` | Standard |
`;

ok('in-sync pins produce no errors', pinDrift(GOOD_SETTINGS, GOOD_GUARDRAILS).length === 0);

// The regression this check exists for: settings bumped, doc left behind.
const DESYNCED = JSON.stringify({
  env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' },
});
const STALE_GUARDRAILS = GOOD_GUARDRAILS.replace('claude-opus-5', 'claude-opus-4-8');
const desyncErrors = pinDrift(DESYNCED, STALE_GUARDRAILS);
ok('DETECTS the real drift (settings opus-5 vs guardrails opus-4-8)', desyncErrors.length === 1);
ok('drift error names the offending env var and value', /ANTHROPIC_DEFAULT_OPUS_MODEL/.test(desyncErrors[0] || '') && /claude-opus-5/.test(desyncErrors[0] || ''));

// Fail-closed behaviours: a broken input must never be a silent pass.
ok('fails closed on unparseable settings.json', pinDrift('{not json', GOOD_GUARDRAILS).length === 1);
ok('fails closed when guardrails has no ISC-3 section', pinDrift(GOOD_SETTINGS, '# unrelated doc').length === 1);
ok('fails closed when no pins are declared', pinDrift(JSON.stringify({ env: {} }), GOOD_GUARDRAILS).length === 1);
ok('fails closed on a missing env block entirely', pinDrift(JSON.stringify({}), GOOD_GUARDRAILS).length === 1);
ok('flags an empty pin value', pinDrift(JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: '' } }), GOOD_GUARDRAILS).some(e => /is empty/.test(e)));

// Unrelated env keys must not be mistaken for pins.
ok(
  'ignores non-pin env keys',
  pinDrift(
    JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5', VLDR_NOTIFY: 'x' } }),
    GOOD_GUARDRAILS
  ).length === 0
);

// And the live repo must actually be consistent right now.
const repoRoot = new URL('..', import.meta.url);
const liveErrors = pinDrift(
  readFileSync(new URL('.claude/settings.json', repoRoot), 'utf8'),
  readFileSync(new URL('framework/guardrails.md', repoRoot), 'utf8')
);
ok(`live repo pins are in sync with guardrails.md${liveErrors.length ? ` (${liveErrors[0]})` : ''}`, liveErrors.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
