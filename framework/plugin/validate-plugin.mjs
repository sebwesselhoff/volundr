#!/usr/bin/env node
// validate-plugin.mjs (FRW-BL-041) — pure-Node plugin/marketplace manifest validator.
//
// CI-friendly (no `claude` CLI, no node_modules): mirrors the garden-lint /
// generate-agents --check pattern. Validates that Volundr's plugin packaging is
// internally consistent so a `claude plugin install` cannot ship a broken manifest:
//
//   .claude-plugin/plugin.json      — valid JSON, kebab-case name, component paths exist
//   hooks/hooks.json                — valid JSON; every ${CLAUDE_PLUGIN_ROOT}-referenced
//                                     script file actually exists in the repo
//   .claude-plugin/marketplace.json — valid JSON, owner + plugins[], each source resolves,
//                                     and the self-entry name agrees with plugin.json
//
// Usage:  node framework/plugin/validate-plugin.mjs [rootDir]
//         exit 0 = ok, exit 1 = one or more errors.
// `claude plugin validate . --strict` remains the authoritative local/dev check;
// this is the dependency-free gate for CI.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..', '..');
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLUGIN_ROOT_REF = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s`)\],]+)/g;

function readJson(absPath, errors, label) {
  if (!existsSync(absPath)) { errors.push(`${label}: missing file ${absPath}`); return null; }
  try { return JSON.parse(readFileSync(absPath, 'utf8')); }
  catch (e) { errors.push(`${label}: invalid JSON (${e.message})`); return null; }
}

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

// Recursively collect every ${CLAUDE_PLUGIN_ROOT}/<path> reference in any string value.
function collectPluginRootRefs(node, out) {
  if (typeof node === 'string') {
    let m;
    PLUGIN_ROOT_REF.lastIndex = 0;
    while ((m = PLUGIN_ROOT_REF.exec(node)) !== null) out.push(m[1]);
  } else if (Array.isArray(node)) {
    for (const x of node) collectPluginRootRefs(x, out);
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) collectPluginRootRefs(node[k], out);
  }
  return out;
}

export function validatePlugin(rootDir = DEFAULT_ROOT) {
  const errors = [];
  const warnings = [];
  const root = resolve(rootDir);

  // --- plugin.json ---
  const pj = readJson(join(root, '.claude-plugin', 'plugin.json'), errors, 'plugin.json');
  if (pj) {
    if (!pj.name) errors.push('plugin.json: missing required "name"');
    else if (!KEBAB.test(pj.name)) errors.push(`plugin.json: name "${pj.name}" is not kebab-case`);

    // skills (additive): dir must exist and contain >=1 <name>/SKILL.md
    for (const p of asArray(pj.skills)) {
      const abs = resolve(root, p);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) { errors.push(`plugin.json: skills path "${p}" is not a directory`); continue; }
      const skillDirs = readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory());
      const withSkillMd = skillDirs.filter((d) => existsSync(join(abs, d.name, 'SKILL.md')));
      if (withSkillMd.length === 0) errors.push(`plugin.json: skills path "${p}" has no <name>/SKILL.md entries`);
    }
    // commands (replaces default): dir must exist and contain >=1 .md
    for (const p of asArray(pj.commands)) {
      const abs = resolve(root, p);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) { errors.push(`plugin.json: commands path "${p}" is not a directory`); continue; }
      const mds = readdirSync(abs).filter((f) => f.endsWith('.md'));
      if (mds.length === 0) warnings.push(`plugin.json: commands path "${p}" has no .md files`);
    }
    // hooks: each referenced file must exist + be valid JSON
    for (const p of asArray(pj.hooks)) {
      if (typeof p !== 'string') continue; // inline object form — validated as data below if present
      const abs = resolve(root, p);
      const hooksDoc = readJson(abs, errors, `plugin.json hooks "${p}"`);
      if (hooksDoc) validateHooksDoc(hooksDoc, root, errors, `hooks "${p}"`);
    }
  }

  // --- standalone hooks/hooks.json (the canonical default location) ---
  const defaultHooks = join(root, 'hooks', 'hooks.json');
  if (existsSync(defaultHooks)) {
    const hooksDoc = readJson(defaultHooks, errors, 'hooks/hooks.json');
    if (hooksDoc) validateHooksDoc(hooksDoc, root, errors, 'hooks/hooks.json');
  }

  // --- hook parity: plugin hooks/hooks.json must mirror .claude/settings.json ---
  // Drift-gate: a hook added to settings.json but not the plugin (or vice-versa)
  // means an installed plugin silently loses (or double-adds) a hook.
  validateHookParity(root, errors);

  // --- skills that reference bundled files via ${CLAUDE_PLUGIN_ROOT} must resolve ---
  // A skill body that points at ${CLAUDE_PLUGIN_ROOT}/<path> (e.g. vldr-boot ->
  // framework/system-instructions.md) only works post-install if that file is bundled
  // at the plugin root. Gate it so the manual can never be dropped from the payload.
  validateSkillBundledRefs(root, errors);

  // --- marketplace.json ---
  const mj = readJson(join(root, '.claude-plugin', 'marketplace.json'), errors, 'marketplace.json');
  if (mj) {
    if (!mj.name) errors.push('marketplace.json: missing required "name"');
    else if (!KEBAB.test(mj.name)) errors.push(`marketplace.json: name "${mj.name}" is not kebab-case`);
    if (!mj.owner || !mj.owner.name) errors.push('marketplace.json: missing required "owner.name"');
    if (!Array.isArray(mj.plugins) || mj.plugins.length === 0) {
      errors.push('marketplace.json: "plugins" must be a non-empty array');
    } else {
      for (const entry of mj.plugins) {
        if (!entry.name) { errors.push('marketplace.json: a plugin entry is missing "name"'); continue; }
        if (!entry.source) { errors.push(`marketplace.json: plugin "${entry.name}" is missing "source"`); continue; }
        const srcAbs = resolve(root, typeof entry.source === 'string' ? entry.source : '.');
        if (!existsSync(srcAbs)) errors.push(`marketplace.json: plugin "${entry.name}" source "${entry.source}" does not resolve`);
        // self-entry (source "./" or ".") name must agree with plugin.json
        const isSelf = typeof entry.source === 'string' && (entry.source === './' || entry.source === '.');
        if (isSelf && pj && entry.name !== pj.name) {
          errors.push(`marketplace.json: self plugin entry name "${entry.name}" != plugin.json name "${pj.name}"`);
        }
        if (isSelf && pj && entry.version && pj.version && entry.version !== pj.version) {
          errors.push(`marketplace.json: self entry version "${entry.version}" != plugin.json version "${pj.version}"`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Deterministic stringify (recursively sorted keys) so key-order never affects equality.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
// Normalize the two root env tokens to a common placeholder so settings.json
// (${CLAUDE_PROJECT_DIR}) and plugin hooks (${CLAUDE_PLUGIN_ROOT}) compare equal.
function normalizeHooks(hooksObj) {
  const s = JSON.stringify(hooksObj || {});
  return JSON.parse(s.split('${CLAUDE_PROJECT_DIR}').join('${ROOT}').split('${CLAUDE_PLUGIN_ROOT}').join('${ROOT}'));
}
// FULL parity: every hook event must be structurally identical (matcher, if,
// timeout, type, args, order) between .claude/settings.json and hooks/hooks.json
// after env-token normalization — not just script-basename equality.
function validateHookParity(root, errors) {
  const settingsPath = join(root, '.claude', 'settings.json');
  const pluginHooksPath = join(root, 'hooks', 'hooks.json');
  if (!existsSync(settingsPath) || !existsSync(pluginHooksPath)) return; // parity only when both exist
  let settings, plugin;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return; }
  try { plugin = JSON.parse(readFileSync(pluginHooksPath, 'utf8')); } catch { return; }
  const s = normalizeHooks(settings.hooks);
  const p = normalizeHooks(plugin.hooks);
  const events = new Set([...Object.keys(s), ...Object.keys(p)]);
  for (const event of events) {
    if (!(event in s)) { errors.push(`hook parity: hooks/hooks.json has event "${event}" absent from .claude/settings.json (plugin adds a hook the dev repo lacks)`); continue; }
    if (!(event in p)) { errors.push(`hook parity: .claude/settings.json has event "${event}" absent from hooks/hooks.json (plugin would lose this hook)`); continue; }
    if (stableStringify(s[event]) !== stableStringify(p[event])) {
      errors.push(`hook parity: event "${event}" differs between .claude/settings.json and hooks/hooks.json after env normalization (matcher/if/timeout/args/order mismatch)`);
    }
  }
}

// Every ${CLAUDE_PLUGIN_ROOT}/<path> referenced inside a SKILL.md body must resolve to a
// real file at the plugin root, or it 404s in a real plugin install (post-substitution).
function validateSkillBundledRefs(root, errors) {
  const skillsDir = join(root, '.claude', 'skills');
  if (!existsSync(skillsDir)) return;
  for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = join(skillsDir, d.name, 'SKILL.md');
    if (!existsSync(md)) continue;
    let body;
    try { body = readFileSync(md, 'utf8'); } catch { continue; }
    for (const rel of collectPluginRootRefs(body, [])) {
      const abs = resolve(root, rel);
      if (!existsSync(abs)) {
        errors.push(`skill '${d.name}': SKILL.md references \${CLAUDE_PLUGIN_ROOT}/${rel} but ${abs} is not bundled at the plugin root (would 404 after install)`);
      }
    }
  }
}

function validateHooksDoc(doc, root, errors, label) {
  const hooks = doc && doc.hooks;
  if (!hooks || typeof hooks !== 'object') { errors.push(`${label}: missing top-level "hooks" object`); return; }
  const refs = collectPluginRootRefs(hooks, []);
  if (refs.length === 0) errors.push(`${label}: no \${CLAUDE_PLUGIN_ROOT} script references found (plugin hooks must self-locate)`);
  for (const rel of refs) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) errors.push(`${label}: referenced script "\${CLAUDE_PLUGIN_ROOT}/${rel}" does not exist (${abs})`);
  }
}

// Run when invoked directly.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT;
  const { ok, errors, warnings } = validatePlugin(root);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (ok) {
    console.log(`ok: plugin packaging valid (${root})`);
    process.exit(0);
  } else {
    for (const e of errors) console.error(`✘ ${e}`);
    console.error(`\nValidation FAILED: ${errors.length} error(s)`);
    process.exit(1);
  }
}
