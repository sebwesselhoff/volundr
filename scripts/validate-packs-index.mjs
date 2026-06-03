#!/usr/bin/env node
/**
 * validate-packs-index.mjs — validates framework/packs/index.json (FRW-BL-061)
 *
 * The index is the validated, machine-readable map of every Volundr pack/skill
 * with provenance. This validator is hand-rolled (no ajv / no new deps) and:
 *   1. SCHEMA SHAPE — checks the index against framework/packs/index.schema.json
 *      (required props, enums, patterns, additionalProperties, version const).
 *   2. VERSION PIN — index.version must equal the schema's top-level `version`.
 *   3. DRIFT — every framework pack dir (with pack.json) and every .claude/skills
 *      SKILL.md must be indexed exactly once; index entries must point at real paths.
 *
 * Used standalone (`node scripts/validate-packs-index.mjs [--repo <path>]`) and
 * invoked from scripts/garden-lint.mjs so a violation fails CI (exit != 0).
 *
 * EXIT: 1 if any error, else 0.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const VALID_SOURCES = ['framework', 'earned', 'community'];
const VALID_RISKS = ['low', 'medium', 'high'];
const VALID_KINDS = ['pack', 'skill'];

/**
 * Pure: validate an index object against a (loaded) schema object plus the
 * on-disk reality (packDirs / skillIds). Returns an array of error strings.
 *
 * @param {object} index   parsed index.json
 * @param {object} schema  parsed index.schema.json
 * @param {{packDirs?: string[], skillIds?: string[]}} disk  on-disk inventory (optional — drift check skipped if absent)
 */
export function validateIndex(index, schema, disk = {}) {
  const errors = [];

  // --- top-level shape ---
  if (typeof index !== 'object' || index === null) {
    return ['index is not a JSON object'];
  }
  const schemaVersion = schema?.version;
  if (typeof schemaVersion !== 'number') {
    errors.push('schema is missing a numeric top-level `version`');
  }
  if (index.version !== schemaVersion) {
    errors.push(`index.version (${index.version}) != schema.version (${schemaVersion})`);
  }
  if (typeof index.generated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(index.generated)) {
    errors.push(`index.generated must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(index.generated)}`);
  }
  if (!Array.isArray(index.entries) || index.entries.length === 0) {
    errors.push('index.entries must be a non-empty array');
    return errors;
  }

  // --- per-entry shape (mirrors index.schema.json $defs/entry) ---
  const required = ['id', 'kind', 'category', 'risk', 'source', 'date_added'];
  const allowed = new Set([...required, 'path', 'version', 'description']);
  const seenIds = new Set();

  index.entries.forEach((e, i) => {
    const at = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
    if (typeof e !== 'object' || e === null) {
      errors.push(`${at}: not an object`);
      return;
    }
    for (const k of required) {
      if (!(k in e)) errors.push(`${at}: missing required prop '${k}'`);
    }
    for (const k of Object.keys(e)) {
      if (!allowed.has(k)) errors.push(`${at}: unknown prop '${k}' (additionalProperties false)`);
    }
    if ('id' in e) {
      if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) {
        errors.push(`${at}: id must match ^[a-z0-9][a-z0-9-]*$`);
      } else if (seenIds.has(e.id)) {
        errors.push(`${at}: duplicate id '${e.id}'`);
      } else {
        seenIds.add(e.id);
      }
    }
    if ('kind' in e && !VALID_KINDS.includes(e.kind)) {
      errors.push(`${at}: kind '${e.kind}' not in {${VALID_KINDS.join('|')}}`);
    }
    if ('category' in e && (typeof e.category !== 'string' || e.category.length === 0)) {
      errors.push(`${at}: category must be a non-empty string`);
    }
    if ('risk' in e && !VALID_RISKS.includes(e.risk)) {
      errors.push(`${at}: risk '${e.risk}' not in {${VALID_RISKS.join('|')}}`);
    }
    if ('source' in e && !VALID_SOURCES.includes(e.source)) {
      errors.push(`${at}: source '${e.source}' not in {${VALID_SOURCES.join('|')}}`);
    }
    if ('date_added' in e && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date_added))) {
      errors.push(`${at}: date_added must be an ISO date (YYYY-MM-DD)`);
    }
  });

  // --- drift: index <-> disk reality (framework entries only) ---
  if (Array.isArray(disk.packDirs)) {
    const indexedPacks = new Set(index.entries.filter((e) => e.kind === 'pack').map((e) => e.id));
    for (const d of disk.packDirs) {
      if (!indexedPacks.has(d)) errors.push(`drift: pack '${d}' exists on disk but is not in index.json`);
    }
    for (const id of indexedPacks) {
      const entry = index.entries.find((e) => e.kind === 'pack' && e.id === id);
      if (entry.source === 'framework' && !disk.packDirs.includes(id)) {
        errors.push(`drift: pack '${id}' is indexed (source=framework) but framework/packs/${id} is missing`);
      }
    }
  }
  if (Array.isArray(disk.skillIds)) {
    const indexedSkills = new Set(index.entries.filter((e) => e.kind === 'skill').map((e) => e.id));
    for (const id of disk.skillIds) {
      if (!indexedSkills.has(id)) errors.push(`drift: skill '${id}' exists on disk but is not in index.json`);
    }
    for (const id of indexedSkills) {
      const entry = index.entries.find((e) => e.kind === 'skill' && e.id === id);
      if (entry.source === 'framework' && !disk.skillIds.includes(id)) {
        errors.push(`drift: skill '${id}' is indexed (source=framework) but .claude/skills/${id} is missing`);
      }
    }
  }

  return errors;
}

/** Load the on-disk inventory of framework packs + skills for the drift check. */
function readDiskInventory(repo) {
  const packsDir = join(repo, 'framework', 'packs');
  const skillsDir = join(repo, '.claude', 'skills');
  const packDirs = existsSync(packsDir)
    ? readdirSync(packsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(packsDir, e.name, 'pack.json')))
        .map((e) => e.name)
    : [];
  const skillIds = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
        .map((e) => e.name)
    : [];
  return { packDirs, skillIds };
}

/**
 * Run the full file-backed validation for a repo. Returns error strings
 * (empty = valid). Reused by garden-lint.mjs so a violation fails CI.
 */
export function validatePacksIndexForRepo(repo) {
  const indexPath = join(repo, 'framework', 'packs', 'index.json');
  const schemaPath = join(repo, 'framework', 'packs', 'index.schema.json');
  if (!existsSync(schemaPath)) return [`index schema missing: ${schemaPath}`];
  if (!existsSync(indexPath)) return [`packs index missing: ${indexPath}`];

  let schema, index;
  try { schema = JSON.parse(readFileSync(schemaPath, 'utf8')); }
  catch (err) { return [`index.schema.json invalid JSON (${err.message})`]; }
  try { index = JSON.parse(readFileSync(indexPath, 'utf8')); }
  catch (err) { return [`index.json invalid JSON (${err.message})`]; }

  return validateIndex(index, schema, readDiskInventory(repo));
}

function main() {
  const repoArgIdx = process.argv.indexOf('--repo');
  const repo = repoArgIdx >= 0 ? process.argv[repoArgIdx + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = validatePacksIndexForRepo(repo);
  for (const e of errors) process.stdout.write(`[validate-packs-index] ERROR ${e}\n`);
  process.stdout.write(`[validate-packs-index] ${errors.length} error(s)\n`);
  process.exit(errors.length > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
