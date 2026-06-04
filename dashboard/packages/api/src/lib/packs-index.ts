/**
 * packs-index.ts — read + browse/search the validated skills/packs index.
 *
 * The index lives at `framework/packs/index.json` (schema:
 * framework/packs/index.schema.json, validated in CI — FRW-BL-061 ISC1/ISC2).
 * It is a versioned, machine-readable catalogue of every pack and skill with
 * provenance (`source`), operational risk, and category.
 *
 * This module provides:
 *   - resolvePacksIndexPath(): robustly locate index.json regardless of where
 *     the API process is launched from (dev `tsx src`, compiled `dist`, Docker).
 *   - loadPacksIndex(): read + JSON.parse the index.
 *   - filterIndexEntries(): a PURE function implementing browse + search
 *     (filter by category and/or risk and/or a free-text query). Unit-tested
 *     in packs-index.test.ts without booting the server.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---- Types ------------------------------------------------------------------

/** A single entry in framework/packs/index.json (mirrors index.schema.json). */
export interface PackIndexEntry {
  id: string;
  kind: 'pack' | 'skill';
  category: string;
  risk: 'low' | 'medium' | 'high';
  /** Provenance — framework | earned | community. */
  source: 'framework' | 'earned' | 'community';
  date_added: string;
  path?: string;
  version?: string;
  description?: string;
}

export interface PackIndex {
  version: number;
  generated: string;
  entries: PackIndexEntry[];
}

/** Browse/search filter — every field is optional (omitted ⇒ no constraint). */
export interface PackIndexQuery {
  /** Exact-match (case-insensitive) on entry.category. */
  category?: string;
  /** Exact-match on entry.risk (low|medium|high). */
  risk?: string;
  /** Exact-match on entry.kind (pack|skill). */
  kind?: string;
  /** Exact-match on entry.source (framework|earned|community). */
  source?: string;
  /** Free-text query — substring (case-insensitive) over id/category/source/description. */
  q?: string;
}

// ---- Pure filter / search ---------------------------------------------------

/**
 * Filter + search index entries. PURE — no I/O, fully unit-testable.
 *
 * Semantics: all provided constraints are ANDed. `q` matches as a
 * case-insensitive substring against id, category, source, and description.
 * An empty/whitespace-only `q` (and any omitted field) is treated as "no
 * constraint" so a bare browse returns everything.
 */
export function filterIndexEntries(
  entries: PackIndexEntry[],
  query: PackIndexQuery = {},
): PackIndexEntry[] {
  const category = query.category?.trim().toLowerCase() || undefined;
  const risk = query.risk?.trim().toLowerCase() || undefined;
  const kind = query.kind?.trim().toLowerCase() || undefined;
  const source = query.source?.trim().toLowerCase() || undefined;
  const q = query.q?.trim().toLowerCase() || undefined;

  return entries.filter((e) => {
    if (category && e.category.toLowerCase() !== category) return false;
    if (risk && e.risk.toLowerCase() !== risk) return false;
    if (kind && e.kind.toLowerCase() !== kind) return false;
    if (source && e.source.toLowerCase() !== source) return false;
    if (q) {
      const haystack = [e.id, e.category, e.source, e.description ?? '']
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// ---- Index location + load --------------------------------------------------

const INDEX_REL_PATH = ['framework', 'packs', 'index.json'];

/**
 * Locate framework/packs/index.json robustly.
 *
 * Resolution order:
 *   1. VLDR_PACKS_INDEX — explicit absolute path to the index file.
 *   2. VLDR_REPO_ROOT / CLAUDE_PROJECT_DIR — repo root; join the rel path.
 *   3. Walk upward from this module's directory looking for the file (handles
 *      both `dist/lib` after build and `src/lib` under `tsx`, and Docker layouts).
 *
 * Returns the first existing path, or null if none found.
 */
export function resolvePacksIndexPath(): string | null {
  const explicit = process.env.VLDR_PACKS_INDEX;
  if (explicit && existsSync(explicit)) return explicit;

  const root = process.env.VLDR_REPO_ROOT || process.env.CLAUDE_PROJECT_DIR;
  if (root) {
    const p = resolve(root, ...INDEX_REL_PATH);
    if (existsSync(p)) return p;
  }

  // Walk up from this file's directory until we hit the index or the fs root.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, ...INDEX_REL_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached fs root
    dir = parent;
  }

  return null;
}

/** Read + parse framework/packs/index.json. Throws if it cannot be located/parsed. */
export function loadPacksIndex(): PackIndex {
  const path = resolvePacksIndexPath();
  if (!path) {
    throw new Error(
      'framework/packs/index.json not found (set VLDR_PACKS_INDEX or VLDR_REPO_ROOT)',
    );
  }
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as PackIndex;
}
