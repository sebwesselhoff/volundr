/**
 * Unit tests for persona-history-synth.ts — pure function tests (no DB).
 */

import { describe, it, expect } from 'vitest';
import { synthesiseHistoryEntry, type CardRow, type QualityScoreRow } from './persona-history-synth.js';

const baseCard: CardRow = {
  id: 'CARD-FRW-001',
  title: 'My Test Card',
  description: 'This card implements a test feature.',
  projectId: 'volundr-meta',
  filesCreated: JSON.stringify(['src/lib/foo.ts', 'src/lib/bar.ts']),
  filesModified: JSON.stringify(['src/routes/cards.ts']),
  isc: JSON.stringify([
    { criterion: 'Feature works end-to-end', passed: true, evidence: 'line 42' },
    { criterion: 'No type errors', passed: true, evidence: null },
  ]),
  assignedPersonaId: 'api-designer',
};

const baseQuality: QualityScoreRow = {
  completeness: 8,
  codeQuality: 7,
  formatCompliance: 9,
  correctness: 8,
  weightedScore: 7.9,
  implementationType: 'agent',
  reviewType: 'self',
};

// ISC-1 + ISC-4: happy-path — returns a row with source='card-close' and expected fields
describe('synthesiseHistoryEntry — happy path', () => {
  it('returns a SynthesisPayload with correct shape and source=card-close', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('card-close');
    expect(result!.entryType).toBe('learning');
    expect(result!.personaId).toBe('api-designer');
    expect(result!.cardId).toBe('CARD-FRW-001');
    expect(result!.projectId).toBe('volundr-meta');
    expect(result!.projectName).toBe('Volundr Meta');
    expect(result!.confidence).toBe(1.0);
  });

  it('content includes card id + title', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    expect(result!.content).toContain('CARD-FRW-001');
    expect(result!.content).toContain('My Test Card');
  });

  it('content includes file names', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    expect(result!.content).toContain('src/lib/foo.ts');
    expect(result!.content).toContain('src/routes/cards.ts');
  });

  it('content includes ISC evidence', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    expect(result!.content).toContain('Feature works end-to-end');
    expect(result!.content).toContain('passed');
  });

  it('content includes quality scores', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    expect(result!.content).toContain('codeQuality=7');
    expect(result!.content).toContain('weighted=7.9');
  });

  it('content includes description (not truncated for short text)', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    expect(result!.content).toContain('This card implements a test feature.');
  });

  it('truncates description at 400 chars', () => {
    const longCard: CardRow = {
      ...baseCard,
      description: 'A'.repeat(600),
    };
    const result = synthesiseHistoryEntry(longCard, baseQuality, 'Volundr Meta');
    // Description segment should have at most 400 + 1 (ellipsis) chars after "Description: "
    const descLine = result!.content.split('\n').find((l) => l.startsWith('Description:'))!;
    const descContent = descLine.slice('Description: '.length);
    expect(descContent.length).toBeLessThanOrEqual(401); // 400 chars + '…'
  });

  it('returns serialised stackTags JSON string', () => {
    const result = synthesiseHistoryEntry(baseCard, baseQuality, 'Volundr Meta');
    // Should be a valid JSON string array
    const tags = JSON.parse(result!.stackTags);
    expect(Array.isArray(tags)).toBe(true);
  });
});

// ISC-5: null persona → returns null
describe('synthesiseHistoryEntry — null persona guard', () => {
  it('returns null when assignedPersonaId is null', () => {
    const cardNoPersona: CardRow = { ...baseCard, assignedPersonaId: null };
    const result = synthesiseHistoryEntry(cardNoPersona, baseQuality, 'Volundr Meta');
    expect(result).toBeNull();
  });
});

// Defensive: null quality score still produces output
describe('synthesiseHistoryEntry — null quality score', () => {
  it('produces a row even when qualityScore is null', () => {
    const result = synthesiseHistoryEntry(baseCard, null, 'Volundr Meta');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('card-close');
    // No quality segment in content when null
    expect(result!.content).not.toContain('Quality:');
  });
});

// Defensive: empty files and isc arrays
describe('synthesiseHistoryEntry — empty optional fields', () => {
  it('handles null filesCreated/filesModified gracefully', () => {
    const card: CardRow = {
      ...baseCard,
      filesCreated: null,
      filesModified: null,
      isc: null,
    };
    const result = synthesiseHistoryEntry(card, baseQuality, 'Volundr Meta');
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain('Files:');
    expect(result!.content).not.toContain('ISC:');
  });
});
