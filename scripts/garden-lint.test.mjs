// Self-test for garden-lint.mjs (FRW-BL-067). Run: node scripts/garden-lint.test.mjs
import { readFileSync, readdirSync, existsSync } from 'fs';
import { extractRegistryRefs, sizeViolations, pinDrift, skillLicenceErrors, skillInvocationErrors, MD_BYTE_CAP } from './garden-lint.mjs';

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

// --- FRW-BL-101: every distributed SKILL.md must declare a licence -------------------------
// All 11 of Volundr's skills passed the spec's REQUIRED fields while omitting `license`, which is
// the field that matters for an artifact redistributed as a public plugin.
const FM = (body) => `---\nname: x\n${body}\n---\n\n# X\n`;

ok('flags a skill with no license field',
  skillLicenceErrors('a/SKILL.md', FM('description: d')).some((e) => /skill-license/.test(e)));
ok('accepts a skill declaring license: MIT',
  skillLicenceErrors('a/SKILL.md', FM('license: MIT\ndescription: d')).length === 0);
ok('an EMPTY license value is still a failure',
  skillLicenceErrors('a/SKILL.md', FM('license:\ndescription: d')).some((e) => /skill-license/.test(e)));
ok('a license mention in the BODY does not satisfy the frontmatter requirement',
  skillLicenceErrors('a/SKILL.md', '---\nname: x\ndescription: d\n---\n\nlicense: MIT\n')
    .some((e) => /skill-license/.test(e)));
ok('missing frontmatter fence is reported distinctly, not as a licence error',
  skillLicenceErrors('a/SKILL.md', '# no frontmatter\n').some((e) => /skill-frontmatter/.test(e)));

ok('unterminated frontmatter is reported distinctly',
  skillLicenceErrors('a/SKILL.md', '---\nname: x\nlicense: MIT\n').some((e) => /unterminated/.test(e)));
ok('tolerates empty/undefined source without throwing',
  skillLicenceErrors('a/SKILL.md', '').length > 0 && skillLicenceErrors('a/SKILL.md', undefined).length > 0);

// And every skill in the live repo must actually declare one right now.
const skillsDir = new URL('.claude/skills/', repoRoot);
const liveSkillErrors = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `${e.name}/SKILL.md`)
  .filter((rel) => existsSync(new URL(rel, skillsDir)))
  .flatMap((rel) => skillLicenceErrors(rel, readFileSync(new URL(rel, skillsDir), 'utf8')));
ok(`every live skill declares a license${liveSkillErrors.length ? ` (${liveSkillErrors[0]})` : ''}`,
  liveSkillErrors.length === 0);

// --- FRW-BL-112: a skill that denies tools must not be model-invocable ----------------------
// `disallowed-tools` is enforced session-wide and inherited by subagents ("Write is disabled for
// this session, in subagents as well as here"), so a MODEL-invocable skill carrying one lets the
// lead strip its own Write/Edit mid-card — which is how this was found, via one vldr-route call.
// Invariant: a denylist implies disable-model-invocation: true.

// COUNTER-PROOF FIRST. This is the EXACT pre-fix frontmatter of vldr-journal (and of route,
// directive, doctor, economy). If the check did NOT fail on it, every assertion below would be
// restating the fix instead of detecting its regression.
const PRE_FIX_JOURNAL = FM('license: MIT\ndescription: d\nuser-invocable: true\ndisable-model-invocation: false\ndisallowed-tools: Write, Edit');
ok('CATCHES the pre-fix config: denylist + disable-model-invocation:false is an error',
  skillInvocationErrors('vldr-journal/SKILL.md', PRE_FIX_JOURNAL).some((e) => /skill-invocation/.test(e)));
ok('the error names the exact field the caller must add',
  skillInvocationErrors('a/SKILL.md', PRE_FIX_JOURNAL).some((e) => /disable-model-invocation: true/.test(e)));

ok('accepts the fixed shape: denylist + disable-model-invocation:true',
  skillInvocationErrors('a/SKILL.md', FM('license: MIT\ndisallowed-tools: Write, Edit\ndisable-model-invocation: true')).length === 0);
ok('a skill with NO denylist is unaffected, model-invocable or not',
  skillInvocationErrors('a/SKILL.md', FM('license: MIT\ndisable-model-invocation: false')).length === 0
  && skillInvocationErrors('b/SKILL.md', FM('license: MIT\ndescription: d')).length === 0);
ok('an OMITTED disable-model-invocation is a failure, not a pass (absence != true)',
  skillInvocationErrors('a/SKILL.md', FM('license: MIT\ndisallowed-tools: Write, Edit')).some((e) => /skill-invocation/.test(e)));
ok('an EMPTY disallowed-tools value does not invent a denylist',
  skillInvocationErrors('a/SKILL.md', FM('license: MIT\ndisallowed-tools:\ndisable-model-invocation: false')).length === 0);
ok('a non-true disable-model-invocation value does not satisfy the check',
  skillInvocationErrors('a/SKILL.md', FM('license: MIT\ndisallowed-tools: Write\ndisable-model-invocation: truthy')).some((e) => /skill-invocation/.test(e)));
ok('a disallowed-tools mention in the BODY is not read as frontmatter',
  skillInvocationErrors('a/SKILL.md', '---\nname: x\nlicense: MIT\n---\n\ndisallowed-tools: Write, Edit\n').length === 0);
ok('malformed frontmatter fails CLOSED, reported as a frontmatter error not an invocation one',
  skillInvocationErrors('a/SKILL.md', '# no frontmatter\n').some((e) => /skill-frontmatter/.test(e))
  && skillInvocationErrors('b/SKILL.md', '---\nname: x\nno closing fence\n').some((e) => /skill-frontmatter/.test(e)));
ok('tolerates empty/undefined source without throwing',
  skillInvocationErrors('a/SKILL.md', '').length > 0 && skillInvocationErrors('a/SKILL.md', undefined).length > 0);

// And no skill in the live repo may violate it right now.
const liveInvocationErrors = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `${e.name}/SKILL.md`)
  .filter((rel) => existsSync(new URL(rel, skillsDir)))
  .flatMap((rel) => skillInvocationErrors(rel, readFileSync(new URL(rel, skillsDir), 'utf8')));
ok(`no live skill denies tools while model-invocable${liveInvocationErrors.length ? ` (${liveInvocationErrors[0]})` : ''}`,
  liveInvocationErrors.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
