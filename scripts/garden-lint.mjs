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
  let refs = { promptTemplates: [], personaTemplates: [], packs: [] };
  if (existsSync(registryPath)) {
    refs = extractRegistryRefs(readFileSync(registryPath, 'utf8'));
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

  // 4. orphan prompt templates (warn only)
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
