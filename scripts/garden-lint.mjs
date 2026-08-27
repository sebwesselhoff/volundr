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

/**
 * FRW-BL-112 — a skill that denies tools must not be model-invocable.
 *
 * `disallowed-tools` is enforced by the platform against the whole SESSION, not just the skill
 * invocation. The platform says so verbatim: "Write is disabled for this session, in subagents as
 * well as here." So a MODEL-invocable skill carrying a Write/Edit denylist is a self-inflicted
 * session kill — the lead strips its own ability to implement, mid-card, by following the
 * framework's own Journal Protocol. That is exactly how this was found: one `vldr-route` call to
 * gather ISC evidence ended file work for the rest of the session and every subagent after it.
 *
 * The invariant, not the incident: any SKILL.md declaring `disallowed-tools` MUST also declare
 * `disable-model-invocation: true`. That keeps the skill operator-invocable (`/vldr-journal` still
 * works) while removing it from the model's reachable set — and it PRESERVES the denylist rather
 * than deleting it to fix the blast radius. Deleting it was the tempting fix and the wrong one:
 * enforcement is now proven, and FRW-BL-101 ISC-2's decision to keep a denylist depends on it.
 *
 * Scope note: this closes the model's path only. An OPERATOR who types a denylisted skill mid-card
 * still loses Write/Edit for the session — irreducible from here, since the platform applies the
 * denial session-wide. Each affected SKILL.md therefore states that blast radius in its own body,
 * because the original defect was as much about silence as about scope.
 *
 * Fails CLOSED on malformed/absent frontmatter, matching skillLicenceErrors. Pure over source text.
 */
export function skillInvocationErrors(rel, src) {
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
  // [ \t] not \s — same trap skillLicenceErrors documents: in JS `\s` matches newlines, so
  // `\s*\S` would skip an EMPTY `disallowed-tools:` line and match the next key's first char,
  // inventing a denylist that is not there. Covered by its own test.
  if (!/^disallowed-tools[ \t]*:[ \t]*\S/m.test(fm)) return out; // no denylist → nothing to enforce
  if (!/^disable-model-invocation[ \t]*:[ \t]*true[ \t]*$/m.test(fm)) {
    out.push(
      `skill-invocation: ${rel} declares disallowed-tools but is model-invocable — add ` +
      `"disable-model-invocation: true". A denied tool is denied for the whole session, subagents ` +
      `included, so the model must not be able to reach this skill (FRW-BL-112)`,
    );
  }
  return out;
}

/**
 * FRW-BL-097 / FRW-BL-098 — third-party attribution, checked rather than remembered.
 *
 * Volundr is MIT and REDISTRIBUTED, so incorporating third-party content obliges us to retain the
 * upstream copyright notice and licence text. Prose asking a future session to remember that is not
 * a mechanism (this project's own anti-pattern list). These functions make it a gate.
 *
 * THE MARKER. A third-party-derived artifact declares a `provenance:` block — in markdown
 * frontmatter, or inline in a YAML data file:
 *
 *     provenance:
 *       source: owner/repo
 *       commit: <full sha or tag>          # "main" is not a pin; it moves
 *       license: MIT
 *       copyright: Copyright (c) 2025 Upstream Holder   # VERBATIM from upstream LICENSE
 *       date: 2026-08-27
 *       taken: what specifically was taken
 *
 * THE FRW-BL-090 TRAP, designed around rather than discovered. This project has now watched a
 * text-scanning gate read English prose as code FOUR times in one day (the hook-config extractor
 * pulling a field out of a comment; anti-stub-scan blocking on its own pattern table; the platform's
 * own guard reading a commit message as a command). So this scanner:
 *   - reads `provenance:` ONLY from a leading frontmatter fence or a `.yaml`/`.yml` file, never
 *     from free prose or a fenced code sample;
 *   - EXCLUDES its own source, its test, and the two documents whose whole subject is this format
 *     (THIRD-PARTY-NOTICES.md, framework/provenance.md), which necessarily quote the marker.
 * Both exclusions are asserted by the self-test, not just intended.
 */
export const PROVENANCE_FIELDS = ['source', 'commit', 'license', 'copyright', 'date', 'taken'];

/**
 * Pure: is this path one whose subject IS the marker format, so a mention is not a declaration?
 *
 * Matched as EXACT repo-relative paths, not by bare filename. A filename-anywhere match would let a
 * ported artifact placed under a scanned directory and named `THIRD-PARTY-NOTICES.md` exempt itself
 * from the very scan that exists to catch it — a small hole, but a hole in an exclusion list is
 * exactly the thing that must not be approximate.
 */
const PROVENANCE_DOC_PATHS = new Set([
  'THIRD-PARTY-NOTICES.md',
  'framework/provenance.md',
  'scripts/garden-lint.mjs',
  'scripts/garden-lint.test.mjs',
]);

export function isProvenanceDoc(rel) {
  return PROVENANCE_DOC_PATHS.has(String(rel ?? '').replace(/\\/g, '/').replace(/^\.\//, ''));
}

/**
 * Pure: parse a minimal YAML subset — `key: value` lines under a known indent, plus `- ` list items.
 * Deliberately tiny: framework scripts are dependency-free by constraint, and a full YAML parser is
 * not needed to read a six-field block. Unknown/again-indented lines end the block.
 */
function parseBlock(lines, startIdx, baseIndent) {
  const out = {};
  let i = startIdx;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) break;
    const m = /^[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();

    // BLOCK SCALARS (`taken: |` / `>`). Without this the value parses to the literal "|" — a
    // non-empty string, so the required-field check passes and the real content is silently lost.
    // `taken` is the field most likely to want several lines, so this is the exact place a silent
    // mis-parse would hurt most and be noticed least.
    if (raw === '|' || raw === '>' || /^[|>][-+]?$/.test(raw)) {
      const fold = raw.startsWith('>');
      const parts = [];
      let j = i + 1;
      let contIndent = null;
      for (; j < lines.length; j++) {
        if (!lines[j].trim()) { parts.push(''); continue; }
        const ind = lines[j].length - lines[j].trimStart().length;
        if (contIndent === null) {
          if (ind <= indent) break;
          contIndent = ind;
        } else if (ind < contIndent) break;
        parts.push(lines[j].slice(contIndent));
      }
      while (parts.length && parts[parts.length - 1] === '') parts.pop();
      out[key] = fold ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n').trim();
      i = j - 1;
      continue;
    }

    out[key] = raw.replace(/^["']|["']$/g, '');
  }
  return { fields: out, next: i };
}

/**
 * Pure: extract every `provenance:` declaration from one artifact's source.
 * @returns {{declarations: Array, errors: string[]}}
 */
export function extractProvenance(rel, src) {
  const declarations = [];
  const errors = [];
  if (isProvenanceDoc(rel)) return { declarations, errors };

  const text = String(src ?? '');
  const path = String(rel ?? '').replace(/\\/g, '/');
  const isYaml = /\.ya?ml$/.test(path);

  let searchable = null;
  if (isYaml) {
    searchable = text;
  } else {
    // Markdown/other: ONLY the leading frontmatter fence counts. A `provenance:` in the body is
    // documentation about the format, not a declaration.
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() === '---') {
      const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
      if (close > 0) searchable = lines.slice(1, close).join('\n');
    }
  }
  if (searchable == null) return { declarations, errors };

  const lines = searchable.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)provenance[ \t]*:[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    const baseIndent = m[1].length;
    const { fields, next } = parseBlock(lines, i + 1, baseIndent);
    i = next - 1;
    const missing = PROVENANCE_FIELDS.filter((f) => !fields[f]);
    if (missing.length) {
      errors.push(
        `provenance-incomplete: ${rel} declares provenance but is missing ${missing.join(', ')} — `
        + 'an incomplete notice looks discharged while being unusable (FRW-BL-097)',
      );
    }
    if (fields.commit && /^(main|master|head)$/i.test(fields.commit)) {
      errors.push(
        `provenance-unpinned: ${rel} pins commit "${fields.commit}", which is a moving branch — `
        + 'pin a full sha or a tag, or the notice describes content nobody can retrieve',
      );
    }
    declarations.push({ file: rel, ...fields });
  }
  return { declarations, errors };
}

/**
 * Pure: read the notices registry out of THIRD-PARTY-NOTICES.md.
 * Entries live in ```yaml fences between the `vldr:entries-begin`/`-end` markers, so the file stays
 * readable as markdown while remaining machine-checkable.
 * @returns {{entries: Array, errors: string[]}}
 */
export function parseNotices(src) {
  const entries = [];
  const errors = [];
  const text = String(src ?? '');
  if (!text.trim()) {
    errors.push('notices-missing: THIRD-PARTY-NOTICES.md is absent or empty — Volundr is MIT and redistributed, so it must exist (FRW-BL-097)');
    return { entries, errors };
  }
  const region = /<!--\s*vldr:entries-begin[^>]*-->([\s\S]*?)<!--\s*vldr:entries-end[^>]*-->/g;
  let block;
  let sawRegion = false;
  while ((block = region.exec(text))) {
    sawRegion = true;
    const fenced = /```ya?ml\s*([\s\S]*?)```/g;
    let f;
    while ((f = fenced.exec(block[1]))) {
      const lines = f[1].split(/\r?\n/);
      let current = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = /^-[ \t]+([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
        if (item) {
          if (current) entries.push(current);
          current = { [item[1]]: item[2].trim().replace(/^["']|["']$/g, '') };
          continue;
        }
        const kv = /^[ \t]+([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
        if (kv && current) current[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
      }
      if (current) entries.push(current);
    }
  }
  if (!sawRegion) {
    errors.push('notices-markers: THIRD-PARTY-NOTICES.md has no vldr:entries-begin/end region — the linter cannot find the registry');
  }
  for (const e of entries) {
    const missing = PROVENANCE_FIELDS.filter((f) => !e[f]);
    if (missing.length) {
      errors.push(`notices-incomplete: entry for "${e.source ?? '(no source)'}" is missing ${missing.join(', ')}`);
    }
  }
  return { entries, errors };
}

/** Pure: the identity a declaration and its notice entry must agree on. */
const provKey = (o) => `${String(o?.source ?? '').trim().toLowerCase()}@${String(o?.commit ?? '').trim().toLowerCase()}`;

/**
 * Pure: cross-check declarations against the notices registry, BOTH directions.
 *
 * Both directions matter and for different reasons. An artifact with no entry is an unmet licence
 * obligation. An entry with no artifact is a stale notice claiming we incorporate something we do
 * not — which is its own kind of false statement in a redistributed file.
 */
export function provenanceErrors(declarations, entries) {
  const out = [];
  const declared = new Map();
  for (const d of declarations || []) declared.set(provKey(d), d);
  const noticed = new Map();
  for (const e of entries || []) noticed.set(provKey(e), e);

  for (const [key, d] of declared) {
    if (!noticed.has(key)) {
      out.push(
        `provenance-unattributed: ${d.file} declares provenance ${d.source}@${String(d.commit).slice(0, 12)} `
        + 'with no matching THIRD-PARTY-NOTICES.md entry — Volundr is redistributed, so this is an '
        + 'unmet attribution obligation (FRW-BL-097)',
      );
      continue;
    }
    const e = noticed.get(key);
    if (e.copyright && d.copyright && e.copyright.trim() !== d.copyright.trim()) {
      out.push(
        `provenance-mismatch: ${d.file} and THIRD-PARTY-NOTICES.md disagree on the copyright holder `
        + `for ${d.source} ("${d.copyright}" vs "${e.copyright}") — the holder must be verbatim from `
        + 'the upstream LICENSE in both places',
      );
    }
  }
  for (const [key, e] of noticed) {
    if (!declared.has(key)) {
      out.push(
        `notices-orphan: THIRD-PARTY-NOTICES.md lists ${e.source}@${String(e.commit).slice(0, 12)} but no `
        + 'artifact in the repo declares that provenance — a notice for content we do not ship is a '
        + 'false statement; remove it or restore the artifact',
      );
    }
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
    // 4d. denylisted skills must not be model-invocable (FRW-BL-112). Same loop, same read: a
    // skill's frontmatter is one artifact, and both checks are distribution defects, not warnings.
    for (const e of skillInvocationErrors(rel, src)) errors.push(e);
  }

  // 4e. third-party attribution (FRW-BL-097 / FRW-BL-098).
  // Volundr is MIT and redistributed, so incorporated third-party content obliges us to retain the
  // upstream notice. Checked in BOTH directions: an artifact with no entry is an unmet licence
  // obligation; an entry with no artifact is a notice claiming we ship something we do not.
  // Scanned surfaces are the ones that can carry a ported artifact — packs (prompts + manifests),
  // skills, personas/traits data, and the agent registry data.
  {
    const provRoots = [
      packsDir,
      join(repo, '.claude', 'skills'),
      join(repo, 'framework', 'agents'),
      join(repo, 'framework', 'personas'),
      join(repo, 'framework', 'skills'),
    ];
    const declarations = [];
    for (const root of provRoots) {
      for (const f of listFiles(root, (p) => /\.(md|ya?ml)$/i.test(p))) {
        const rel = f.replace(repo + '\\', '').replace(repo + '/', '').replace(/\\/g, '/');
        let src;
        try { src = readFileSync(f, 'utf8'); } catch { continue; }
        const { declarations: d, errors: e } = extractProvenance(rel, src);
        declarations.push(...d);
        for (const err of e) errors.push(err);
      }
    }
    const noticesPath = join(repo, 'THIRD-PARTY-NOTICES.md');
    // Absent notices file is an ERROR only once something actually declares provenance — an empty
    // repo owes nobody an attribution, and a gate that fires on a clean tree gets disabled.
    if (!existsSync(noticesPath)) {
      if (declarations.length) errors.push('notices-missing: THIRD-PARTY-NOTICES.md not found, but artifacts declare third-party provenance');
    } else {
      const { entries, errors: nerr } = parseNotices(readFileSync(noticesPath, 'utf8'));
      for (const e of nerr) errors.push(e);
      for (const e of provenanceErrors(declarations, entries)) errors.push(e);
    }
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
