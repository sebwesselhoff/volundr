#!/usr/bin/env node
/**
 * trait-select.mjs — the trait-injection rules, as code rather than as prose (FRW-BL-110)
 *
 * `framework/system-instructions.md` § Trait Injection at Spawn Time defines how Volundr composes an
 * agent's `### Traits` section: gather candidates from several sources, DEDUPLICATE (first
 * occurrence wins), and stay inside a budget of 1-3 typical / 5 maximum.
 *
 * Those rules were prose only, which matters more here than it first appears. Traits are injected
 * into live prompts, so every trait added to `traits.yaml` changes agent behaviour — the card that
 * adds them says to treat each one with the same care as a steering rule. A vocabulary that grows
 * while the selection rules stay unchecked is how you end up with five near-synonyms competing for
 * three slots, where which one survives depends on undocumented source ordering.
 *
 * This module is pure over its inputs so the rules are testable without spawning anything. It does
 * NOT own the runtime: Volundr composes the prompt and consults this, the same relationship
 * `loop-controller.mjs` and `swarm-controller.mjs` have with the loop.
 *
 * USAGE
 *   node scripts/trait-select.mjs                 # validate traits.yaml + registry defaultTraits
 * EXIT: 1 on an unknown trait reference or a malformed vocabulary, else 0.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** Budget from § Trait Injection: "1-3 traits typical, never more than 5." */
export const TRAIT_BUDGET = 5;

/** Top-level keys in traits.yaml that are file metadata, not selectable trait categories. */
export const RESERVED_KEYS = new Set(['provenance']);

/**
 * Pure: read the trait vocabulary out of traits.yaml.
 *
 * The file is a fixed two-level shape — `category:` then `  trait-name:` then `    inject: |`. A
 * hand-rolled scan is used rather than a YAML dependency because framework scripts must run on a
 * bare Node install (project constraint). The shape is checked rather than assumed: a trait with no
 * `inject:` body is reported, since an empty trait injects nothing while still consuming a slot in
 * a 5-trait budget — silently weakening every prompt that selects it.
 *
 * @returns {{ traits: Map<string,string>, categories: Object, errors: string[] }}
 */
export function parseVocabulary(src) {
  const traits = new Map();
  const categories = {};
  const errors = [];
  const lines = String(src ?? '').split(/\r?\n/);

  let category = null;
  let current = null;
  let sawInject = false;
  let skippingReserved = false;

  const closeTrait = () => {
    if (current && !sawInject) errors.push(`trait "${current}" has no inject: body — it would consume a budget slot and inject nothing`);
    current = null;
    sawInject = false;
  };

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const cat = /^([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (cat) {
      closeTrait();
      // RESERVED top-level keys are metadata about the file, not trait categories. `provenance:`
      // is read by garden-lint's attribution gate (FRW-BL-097/098); without this it would parse as
      // an empty category and inflate the category count with something nobody can select.
      if (RESERVED_KEYS.has(cat[1])) { skippingReserved = true; category = null; continue; }
      skippingReserved = false;
      category = cat[1];
      categories[category] = [];
      continue;
    }
    if (skippingReserved) continue;
    const trait = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (trait) {
      closeTrait();
      if (!category) { errors.push(`trait "${trait[1]}" appears before any category`); continue; }
      current = trait[1];
      if (traits.has(current)) errors.push(`trait "${current}" is defined twice — the second definition silently wins`);
      traits.set(current, category);
      categories[category].push(current);
      continue;
    }
    if (/^ {4}inject:\s*[|>]?\s*$/.test(line)) sawInject = true;
  }
  closeTrait();

  if (traits.size === 0) errors.push('no traits parsed — the vocabulary is empty or its shape changed');
  return { traits, categories, errors };
}

/**
 * Pure: apply the documented selection rules.
 *
 * `sources` is an ORDERED list of `{ origin, traits }`. Order encodes precedence, and it is the
 * order § Trait Injection lists: card signals, project constraints, steering rules, developer
 * override, then registry defaults. First occurrence wins, so a trait justified by the card outranks
 * the same trait arriving as a registry default — and the RESULT is identical either way, which is
 * the point of deduplicating rather than concatenating.
 *
 * Over-budget traits are DROPPED FROM THE TAIL and reported. Silently truncating would mean a
 * registry default could push out a card-signalled trait with nobody the wiser.
 *
 * @returns {{ selected: string[], duplicates: Array, dropped: Array, errors: string[] }}
 */
export function selectTraits(sources, { budget = TRAIT_BUDGET, available = null } = {}) {
  const selected = [];
  const duplicates = [];
  const dropped = [];
  const errors = [];
  const seen = new Map();

  for (const source of Array.isArray(sources) ? sources : []) {
    const origin = source?.origin ?? 'unknown';
    for (const name of Array.isArray(source?.traits) ? source.traits : []) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const trait = name.trim();
      if (available && !available.has(trait)) {
        errors.push(`unknown trait "${trait}" requested by ${origin} — not defined in traits.yaml`);
        continue;
      }
      if (seen.has(trait)) {
        duplicates.push({ trait, origin, keptFrom: seen.get(trait) });
        continue;
      }
      seen.set(trait, origin);
      if (selected.length >= budget) {
        dropped.push({ trait, origin, reason: `budget of ${budget} already filled` });
        continue;
      }
      selected.push(trait);
    }
  }
  return { selected, duplicates, dropped, errors };
}

/** Pure: registry `defaultTraits` that name nothing in the vocabulary (dead-reference guard). */
export function unknownTraitRefs(registrySrc, available) {
  const out = [];
  const re = /defaultTraits\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(String(registrySrc ?? '')))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '');
      if (name && !available.has(name)) out.push(name);
    }
  }
  return [...new Set(out)];
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const vocab = parseVocabulary(readFileSync(join(root, 'framework', 'agents', 'traits.yaml'), 'utf8'));
  const errors = [...vocab.errors];

  let registrySrc = '';
  for (const f of ['registry.data.mjs', 'registry.ts']) {
    try { registrySrc += readFileSync(join(root, 'framework', 'agents', f), 'utf8'); } catch { /* optional */ }
  }
  for (const name of unknownTraitRefs(registrySrc, vocab.traits)) {
    errors.push(`registry defaultTraits names "${name}", which is not defined in traits.yaml`);
  }

  process.stdout.write(`[trait-select] ${vocab.traits.size} trait(s) across ${Object.keys(vocab.categories).length} categor(ies)\n`);
  for (const e of errors) process.stdout.write(`[trait-select] ERROR ${e}\n`);
  process.stdout.write(`[trait-select] ${errors.length} error(s)\n`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
