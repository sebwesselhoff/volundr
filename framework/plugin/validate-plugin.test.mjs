#!/usr/bin/env node
// Self-test for validate-plugin.mjs (FRW-BL-041).
// Proves: (1) the REAL repo packaging validates clean; (2) the validator returns
// ok:false on each broken-manifest class (bad name, missing component path,
// dangling ${CLAUDE_PLUGIN_ROOT} hook script, marketplace self-entry mismatch).

import { validatePlugin } from './validate-plugin.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}`); } }

// --- scaffolding for synthetic broken roots ---
function scaffold(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'vldr-plugin-test-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, '.claude', 'skills', 'demo'), { recursive: true });
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(root, 'hooks'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nx');
  writeFileSync(join(root, '.claude', 'commands', 'demo.md'), '# demo');
  writeFileSync(join(root, '.claude', 'hooks', 'good.js'), '// noop');
  const files = {
    'plugin.json': {
      name: 'demo-plugin', version: '1.0.0',
      skills: './.claude/skills', commands: ['./.claude/commands'], hooks: './hooks/hooks.json',
    },
    'marketplace.json': {
      name: 'demo-plugin', owner: { name: 'T' },
      plugins: [{ name: 'demo-plugin', source: './' }],
    },
    'hooks.json': { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/.claude/hooks/good.js'] }] }] } },
    // settings.json mirrors hooks.json (same event -> same script) so parity passes by default
    'settings.json': { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/good.js'] }] }] } },
  };
  mutate(files);
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(files['plugin.json'], null, 2));
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify(files['marketplace.json'], null, 2));
  writeFileSync(join(root, 'hooks', 'hooks.json'), JSON.stringify(files['hooks.json'], null, 2));
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(files['settings.json'], null, 2));
  return root;
}
function withRoot(mutate, fn) { const r = scaffold(mutate); try { return fn(r); } finally { rmSync(r, { recursive: true, force: true }); } }

console.log('validate-plugin.test.mjs');

// 1. The real repo must validate clean.
const real = validatePlugin(REAL_ROOT);
ok('real repo packaging validates (ok:true, 0 errors)', real.ok && real.errors.length === 0);
if (!real.ok) for (const e of real.errors) console.error(`      real-error: ${e}`);

// 2. A clean synthetic root validates.
ok('clean synthetic root validates', withRoot(() => {}, (r) => validatePlugin(r).ok));

// 3. Non-kebab plugin name -> fail.
ok('bad plugin name fails', withRoot((f) => { f['plugin.json'].name = 'Demo Plugin'; }, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /not kebab-case/.test(e));
}));

// 4. Missing skills path -> fail.
ok('missing skills path fails', withRoot((f) => { f['plugin.json'].skills = './.claude/does-not-exist'; }, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /skills path/.test(e));
}));

// 5. Dangling ${CLAUDE_PLUGIN_ROOT} hook script -> fail.
ok('dangling hook script reference fails', withRoot((f) => {
  f['hooks.json'].hooks.SessionStart[0].hooks[0].args = ['${CLAUDE_PLUGIN_ROOT}/.claude/hooks/missing.js'];
}, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /does not exist/.test(e) && /missing\.js/.test(e));
}));

// 6. Hooks doc with no ${CLAUDE_PLUGIN_ROOT} refs -> fail (plugin hooks must self-locate).
ok('hooks with no CLAUDE_PLUGIN_ROOT refs fails', withRoot((f) => {
  f['hooks.json'].hooks.SessionStart[0].hooks[0] = { type: 'command', command: 'node', args: ['./.claude/hooks/good.js'] };
}, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /CLAUDE_PLUGIN_ROOT/.test(e));
}));

// 7. Marketplace self-entry name mismatch -> fail.
ok('marketplace self-entry name mismatch fails', withRoot((f) => { f['marketplace.json'].plugins[0].name = 'other-name'; }, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /self plugin entry name/.test(e));
}));

// 8. Marketplace missing owner -> fail.
ok('marketplace missing owner fails', withRoot((f) => { delete f['marketplace.json'].owner; }, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /owner/.test(e));
}));

// 9. Invalid JSON plugin.json -> fail (write garbage).
ok('invalid plugin.json JSON fails', (() => {
  const r = mkdtempSync(join(tmpdir(), 'vldr-plugin-badjson-'));
  try {
    mkdirSync(join(r, '.claude-plugin'), { recursive: true });
    writeFileSync(join(r, '.claude-plugin', 'plugin.json'), '{ not valid json');
    const v = validatePlugin(r);
    return !v.ok && v.errors.some((e) => /invalid JSON/.test(e));
  } finally { rmSync(r, { recursive: true, force: true }); }
})());

// 10. Hook parity: settings.json has a hook missing from hooks.json -> fail.
ok('hook parity: settings hook missing from plugin fails', withRoot((f) => {
  f['settings.json'].hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/good.js'] }] }];
}, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /hook parity/.test(e) && /Stop/.test(e));
}));

// 11. Hook parity: plugin has a hook missing from settings.json -> fail.
ok('hook parity: plugin hook missing from settings fails', withRoot((f) => {
  f['hooks.json'].hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/.claude/hooks/good.js'] }] }];
}, (r) => {
  const v = validatePlugin(r); return !v.ok && v.errors.some((e) => /hook parity/.test(e) && /Stop/.test(e));
}));

// 12. Skill referencing a missing ${CLAUDE_PLUGIN_ROOT} bundled file -> fail.
ok('skill bundled-ref to missing file fails', withRoot(() => {}, (r) => {
  writeFileSync(join(r, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nRead ${CLAUDE_PLUGIN_ROOT}/framework/nope.md');
  const v = validatePlugin(r);
  return !v.ok && v.errors.some((e) => /not bundled at the plugin root/.test(e) && /nope\.md/.test(e));
}));

// 13. Skill referencing an EXISTING bundled file (backtick-wrapped) -> pass.
ok('skill bundled-ref to existing file passes (backtick-wrapped)', withRoot(() => {}, (r) => {
  mkdirSync(join(r, 'framework'), { recursive: true });
  writeFileSync(join(r, 'framework', 'manual.md'), 'x');
  writeFileSync(join(r, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nRead `${CLAUDE_PLUGIN_ROOT}/framework/manual.md` now.');
  return validatePlugin(r).ok;
}));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
