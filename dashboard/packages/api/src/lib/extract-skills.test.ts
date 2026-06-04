import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { extractSkillsFromHistory, type HistoryEntryInput } from './extract-skills.js';

// FRW-BL-061 ISC4 — provenance carried through extractSkills.
//
// extract-skills computes an index-enum-aligned `source` ('earned' for
// history-derived skills). The personas route MUST persist that computed
// source instead of the old hardcoded 'extracted'. These tests assert both:
//   (a) extraction produces a valid index-enum source, and
//   (b) the route no longer hardcodes 'extracted' (regression guard).

const __dirname = dirname(fileURLToPath(import.meta.url));

function entry(over: Partial<HistoryEntryInput> = {}): HistoryEntryInput {
  return {
    id: 1,
    personaId: 'dev-backend',
    entryType: 'learning',
    content: 'Prefer idempotent migrations to avoid double-apply drift in CI.',
    projectId: 'p1',
    projectName: 'Proj One',
    stackTags: ['database'],
    confidence: 0.9,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

const INDEX_SOURCES = ['framework', 'earned', 'community'];

describe('extractSkillsFromHistory provenance', () => {
  it("tags extracted skills with the index-enum source 'earned'", () => {
    const { skills } = extractSkillsFromHistory({
      personaId: 'dev-backend',
      personaRole: 'Backend Developer',
      entries: [entry({ id: 1 }), entry({ id: 2, content: 'Use parameterized queries everywhere.' })],
    });
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(s.source).toBe('earned');
      expect(INDEX_SOURCES).toContain(s.source);
    }
  });
});

describe('personas route insert (ISC4 regression guard)', () => {
  const routeSrc = readFileSync(
    resolve(__dirname, '..', 'routes', 'personas.ts'),
    'utf8',
  );

  it("does not hardcode source: 'extracted' on the skill insert", () => {
    expect(routeSrc).not.toMatch(/source:\s*['"]extracted['"]/);
  });

  it('persists the computed skill.source (with safe earned fallback)', () => {
    expect(routeSrc).toMatch(/source:\s*skill\.source\s*\?\?\s*['"]earned['"]/);
  });
});
