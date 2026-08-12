#!/usr/bin/env node
/**
 * garden-lint.mjs — framework "garden" drift + size-cap linter (FRW-BL-067)
 *
 * Keeps framework/packs + registry.ts + prompt/skill templates consistent:
 *   1. DEAD CROSS-REFERENCES — every registry.ts `promptTemplate` / `personaTemplate` / `pack`
 *      must point at something that exists on disk (drift between the registry and the tree).
 *   2. PACK MANIFESTS — every framework/packs/<name>/pack.json must parse + have name & version.
 *   3. SIZE CAPS — prompt templates and SKILL.md files must stay under a byte cap (bloat guard).
 *   4. ORPHANS (warn) — prompt templates not referenced by any registry entry.
 *
 * USAGE: node scripts/garden-lint.mjs [--repo <path>]
 * EXIT: 1 if any ERROR (dead ref / bad manifest / size-cap), else 0. Warnings never fail.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePacksIndexForRepo } from './validate-packs-index.mjs';

export const MD_BYTE_CAP = 16000; // generous; flags egregiously bloated prompt/skill files

/** Pure: extract registry cross-references from registry.ts source text. */
export function extractRegistryRefs(src) {
  const grab = (re) => { const out = []; let m; while ((m = re.exec(src))) out.push(m[1]); return out; };
  return {
    promptTemplates: grab(/promptTemplate:\s*'([^']+)'/g),
    personaTemplates: grab(/personaTemplate:\s*'([^']+)'/g),
    packs: [...new Set(grab(/\bpack:\s*'([^']+)'/g))],
  };
}

/** Pure: given [{path, bytes}], return those over the cap. */
export function sizeViolations(files, cap = MD_BYTE_CAP) {
  return files.filter((f) => f.bytes > cap);
}

/**
 * Pure: model-pin drift between .claude/settings.json and guardrails.md ISC-3 (FRW-BL-082).
 *
 * The pin lives in settings.json but is DOCUMENTED as a contract in guardrails.md ISC-3, and
 * framework/model-tiering.md states the two must always move together. They drifted once
 * (settings said claude-opus-5 while ISC-3 still said claude-opus-4-8), so couple them in CI:
 * every ANTHROPIC_DEFAULT_*_MODEL literal in settings.json must appear verbatim in guardrails.md.
 *
 * Fails CLOSED: unparseable settings, or a guardrails doc with no ISC-3 section, is an error —
 * never a silent pass.
 *
 * @returns {string[]} error strings (empty = consistent)
 */
/**
 * FRW-BL-101 — every distributed SKILL.md must declare its licence.
 *
 * Volundr's own 11 skills all passed the Agent Skills spec's REQUIRED fields while silently
 * omitting `license` — the one field that matters most for an artifact that ships publicly as a
 * plugin. Returns ERROR strings (not warnings): a skill added without a licence is a distribution
 * defect, and warnings get scrolled past.
 *
 * Pure over source text so it is directly testable, matching pinDrift's shape.
 */
export function skillLicenceErrors(rel, src) {
  const out = [];
  const lines = String(src ?? '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    out.push(`skill-frontmatter: ${rel} has no frontmatter fence on line 1`);
    return out;
  }
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) {
    out.push(`skill-frontmatter: ${rel} has an unterminated frontmatter block`);
    return out;
  }
  const fm = lines.slice(1, close).join('\n');
  // [ \t] not \s — in JS `\s` matches newlines, so `\s*\S` would happily skip an EMPTY
  // `license:` line and match the first character of the NEXT key. Caught by its own test.
  if (!/^license[ \t]*:[ \t]*\S/m.test(fm)) {
    out.push(`skill-license: ${rel} does not declare a license (Volundr is redistributed; declare it)`);
  }
  return out;
}

export function pinDrift(settingsSrc, guardrailsSrc) {
  const errors = [];

  let settings;
  try {
    settings = JSON.parse(settingsSrc);
  } catch (err) {
    return [`settings.json did not parse (${err.message}) — cannot verify model pins`];
  }

  const env = (settings && settings.env) || {};
  const pins = Object.keys(env)
    .filter((k) => /^ANTHROPIC_DEFAULT_[A-Z0-9]+_MODEL$/.test(k))
    .map((k) => ({ key: k, value: String(env[k]) }));

  if (pins.length === 0) {
    return ['settings.json declares no ANTHROPIC_DEFAULT_*_MODEL pins — expected at least one'];
  }
  if (!/ISC-3/.test(guardrailsSrc)) {
    return ['guardrails.md has no ISC-3 section — cannot verify model pins'];
  }

  for (const { key, value } of pins) {
    if (!value) {
      errors.push(`${key} is empty in settings.json`);
      continue;
    }
    if (!guardrailsSrc.includes(value)) {
      errors.push(
        `model-pin drift: settings.json ${key}="${value}" but guardrails.md ISC-3 does not mention "${value}" ` +
          `— update framework/guardrails.md (ISC-3 table AND the Summary checklist) to match`
      );
    }
    if (!guardrailsSrc.includes(key)) {
      errors.push(`model-pin drift: guardrails.md ISC-3 does not document ${key}`);
    }
  }
  return errors;
}

function listFiles(dir, filter) {
  const out = [];
  const walk = (d) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function main() {
  const repoArgIdx = process.argv.indexOf('--repo');
  const repo = repoArgIdx >= 0 ? process.argv[repoArgIdx + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = [];
  const warnings = [];

  // 1. registry cross-references
  const registryPath = join(repo, 'framework', 'agents', 'registry.ts');
  const registryDataPath = join(repo, 'framework', 'agents', 'registry.data.mjs');
  let refs = { promptTemplates: [], personaTemplates: [], packs: [] };
  if (existsSync(registryPath)) {
    // FRW-BL-037 moved the AGENT_REGISTRY data out of registry.ts into registry.data.mjs;
    // promptTemplate/personaTemplate/pack refs may live in either file, so scan BOTH.
    let registrySrc = readFileSync(registryPath, 'utf8');
    if (existsSync(registryDataPath)) registrySrc += '\n' + readFileSync(registryDataPath, 'utf8');
    refs = extractRegistryRefs(registrySrc);
    for (const pt of refs.promptTemplates) {
      if (!existsSync(join(repo, pt))) errors.push(`dead promptTemplate ref: ${pt} (registry.ts) — file missing`);
    }
    for (const id of [...new Set(refs.personaTemplates)]) {
      if (!existsSync(join(repo, 'framework', 'personas', 'seeds', id))) errors.push(`dead personaTemplate ref: ${id} — framework/personas/seeds/${id} missing`);
    }
    for (const pk of refs.packs) {
      if (!existsSync(join(repo, 'framework', 'packs', pk))) errors.push(`dead pack ref: ${pk} — framework/packs/${pk} missing`);
    }
  } else {
    errors.push(`registry.ts not found at ${registryPath}`);
  }

  // 2. pack manifests
  const packsDir = join(repo, 'framework', 'packs');
  if (existsSync(packsDir)) {
    for (const e of readdirSync(packsDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const manifest = join(packsDir, e.name, 'pack.json');
      if (!existsSync(manifest)) { errors.push(`pack ${e.name}: missing pack.json`); continue; }
      try {
        const j = JSON.parse(readFileSync(manifest, 'utf8'));
        if (!j.name || !j.version) errors.push(`pack ${e.name}: pack.json missing name/version`);
      } catch (err) { errors.push(`pack ${e.name}: pack.json invalid JSON (${err.message})`); }
    }
  }

  // 3. size caps (prompt templates + SKILL.md)
  const mdFiles = [
    ...listFiles(packsDir, (p) => p.includes('prompts') && p.endsWith('.md')),
    ...listFiles(join(repo, '.claude', 'skills'), (p) => p.endsWith('SKILL.md')),
  ].map((p) => ({ path: p, bytes: (() => { try { return statSync(p).size; } catch { return 0; } })() }));
  for (const v of sizeViolations(mdFiles)) errors.push(`size-cap: ${v.path.replace(repo, '.')} = ${v.bytes}B > ${MD_BYTE_CAP}B`);

  // 4. validated skills/packs index (FRW-BL-061) — schema + provenance + drift
  for (const e of validatePacksIndexForRepo(repo)) errors.push(`packs-index: ${e}`);

  // 4b. model-pin drift: settings.json vs guardrails.md ISC-3 (FRW-BL-082)
  const settingsPath = join(repo, '.claude', 'settings.json');
  const guardrailsPath = join(repo, 'framework', 'guardrails.md');
  if (!existsSync(settingsPath)) {
    errors.push('model-pin: .claude/settings.json not found');
  } else if (!existsSync(guardrailsPath)) {
    errors.push('model-pin: framework/guardrails.md not found');
  } else {
    for (const e of pinDrift(readFileSync(settingsPath, 'utf8'), readFileSync(guardrailsPath, 'utf8'))) {
      errors.push(e);
    }
  }

  // 4c. SKILL.md licence declaration (FRW-BL-101)
  // Volundr ships publicly as a plugin, so every skill it distributes must declare its licence.
  // All 11 passed the spec's REQUIRED fields while silently omitting `license`, which is exactly
  // the field that matters for a redistributed artifact. An error, not a warning: a skill added
  // without one is a distribution defect, and warnings get scrolled past.
  for (const f of listFiles(join(repo, '.claude', 'skills'), (p) => p.endsWith('SKILL.md'))) {
    const rel = f.replace(repo + '\\', '').replace(repo + '/', '').replace(/\\/g, '/');
    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch (err) {
      errors.push(`skill-frontmatter: ${rel} unreadable (${err.message})`);
      continue;
    }
    for (const e of skillLicenceErrors(rel, src)) errors.push(e);
  }

  // 5. orphan prompt templates (warn only)
  const referenced = new Set(refs.promptTemplates.map((p) => p.replace(/\//g, '\\')).concat(refs.promptTemplates));
  for (const f of listFiles(packsDir, (p) => p.includes('prompts') && p.endsWith('.md'))) {
    const rel = f.replace(repo + '\\', '').replace(repo + '/', '').replace(/\\/g, '/');
    if (!refs.promptTemplates.includes(rel)) warnings.push(`orphan prompt (not referenced by registry): ${rel}`);
  }

  for (const w of warnings) process.stdout.write(`[garden-lint] WARN  ${w}\n`);
  for (const e of errors) process.stdout.write(`[garden-lint] ERROR ${e}\n`);
  process.stdout.write(`[garden-lint] ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(errors.length > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
