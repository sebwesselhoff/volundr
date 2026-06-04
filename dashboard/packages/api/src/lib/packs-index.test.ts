import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  filterIndexEntries,
  loadPacksIndex,
  resolvePacksIndexPath,
  type PackIndexEntry,
} from './packs-index.js';

// FRW-BL-061 ISC3 — browse/search over framework/packs/index.json.
// The filter is a pure function and is exercised without booting the server.

const SAMPLE: PackIndexEntry[] = [
  {
    id: 'core',
    kind: 'pack',
    category: 'core',
    risk: 'high',
    source: 'framework',
    date_added: '2026-06-03',
    description: 'Core agent types — always loaded.',
  },
  {
    id: 'frontend',
    kind: 'pack',
    category: 'domain',
    risk: 'low',
    source: 'framework',
    date_added: '2026-06-03',
    description: 'Frontend, design, and accessibility.',
  },
  {
    id: 'azure',
    kind: 'pack',
    category: 'domain',
    risk: 'high',
    source: 'framework',
    date_added: '2026-06-03',
    description: 'Azure cloud specialization.',
  },
  {
    id: 'vldr-status',
    kind: 'skill',
    category: 'diagnostics',
    risk: 'low',
    source: 'framework',
    date_added: '2026-06-03',
    description: 'Show current Volundr project status.',
  },
  {
    id: 'team-retro-pattern',
    kind: 'skill',
    category: 'process',
    risk: 'medium',
    source: 'earned',
    date_added: '2026-06-03',
    description: 'Retro pattern learned from project history.',
  },
];

describe('filterIndexEntries (pure browse/search)', () => {
  it('returns all entries for an empty query (browse)', () => {
    expect(filterIndexEntries(SAMPLE)).toHaveLength(SAMPLE.length);
    expect(filterIndexEntries(SAMPLE, {})).toHaveLength(SAMPLE.length);
  });

  it('treats whitespace-only fields as no constraint', () => {
    expect(filterIndexEntries(SAMPLE, { q: '   ', category: '' })).toHaveLength(
      SAMPLE.length,
    );
  });

  it('filters by category (case-insensitive)', () => {
    const r = filterIndexEntries(SAMPLE, { category: 'DOMAIN' });
    expect(r.map((e) => e.id).sort()).toEqual(['azure', 'frontend']);
  });

  it('filters by risk', () => {
    const r = filterIndexEntries(SAMPLE, { risk: 'high' });
    expect(r.map((e) => e.id).sort()).toEqual(['azure', 'core']);
  });

  it('filters by kind', () => {
    expect(filterIndexEntries(SAMPLE, { kind: 'skill' })).toHaveLength(2);
    expect(filterIndexEntries(SAMPLE, { kind: 'pack' })).toHaveLength(3);
  });

  it('filters by source (provenance)', () => {
    const r = filterIndexEntries(SAMPLE, { source: 'earned' });
    expect(r.map((e) => e.id)).toEqual(['team-retro-pattern']);
  });

  it('free-text q matches id/category/source/description (case-insensitive)', () => {
    expect(filterIndexEntries(SAMPLE, { q: 'azure' }).map((e) => e.id)).toEqual([
      'azure',
    ]);
    // matches description text
    expect(
      filterIndexEntries(SAMPLE, { q: 'accessibility' }).map((e) => e.id),
    ).toEqual(['frontend']);
    // matches source token
    expect(filterIndexEntries(SAMPLE, { q: 'earned' }).map((e) => e.id)).toEqual([
      'team-retro-pattern',
    ]);
  });

  it('ANDs multiple constraints', () => {
    const r = filterIndexEntries(SAMPLE, { category: 'domain', risk: 'high' });
    expect(r.map((e) => e.id)).toEqual(['azure']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterIndexEntries(SAMPLE, { q: 'no-such-thing' })).toEqual([]);
  });
});

describe('packs index on disk', () => {
  it('resolves and parses framework/packs/index.json', () => {
    const path = resolvePacksIndexPath();
    expect(path).toBeTruthy();
    const raw = JSON.parse(readFileSync(path!, 'utf8'));
    expect(raw.version).toBe(1);
    expect(Array.isArray(raw.entries)).toBe(true);
    expect(raw.entries.length).toBeGreaterThan(0);
  });

  it('loadPacksIndex returns entries that can be filtered', () => {
    const index = loadPacksIndex();
    const packs = filterIndexEntries(index.entries, { kind: 'pack' });
    const skills = filterIndexEntries(index.entries, { kind: 'skill' });
    expect(packs.length + skills.length).toBe(index.entries.length);
    // every entry source conforms to the index enum
    for (const e of index.entries) {
      expect(['framework', 'earned', 'community']).toContain(e.source);
    }
  });
});
