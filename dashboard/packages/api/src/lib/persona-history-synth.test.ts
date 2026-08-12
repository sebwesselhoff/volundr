/**
 * Unit tests for persona-history-synth.ts — pure function tests (no DB).
 */

import { describe, it, expect } from 'vitest';
import { synthesiseHistoryEntry, confidenceFromQuality, type CardRow, type QualityScoreRow } from './persona-history-synth.js';

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
    // FRW-BL-096: was `toBe(1.0)` — a constant that pinned the defect. baseQuality is 7.9
    // ("solidly meets spec"), which the calibration maps to 0.65 → the 'medium' bucket.
    expect(result!.confidence).toBe(0.65);
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

// ---------------------------------------------------------------------------
// FRW-BL-096 — confidence must derive from the quality score, not a constant
// ---------------------------------------------------------------------------
// The old code set confidence = 1.0 unconditionally, so extract-skills' CONFIDENCE_THRESHOLD
// (0.5) filter and its low/medium/high mapping (>= 0.75 high, >= 0.4 medium) discriminated
// nothing on the card-close path — and that is the COMMON path for flat / Volundr-direct work.
// The score was already a parameter; it was rendered into the body and then thrown away.
describe('confidenceFromQuality — calibration bands', () => {
  it('maps reference-quality scores to the high bucket', () => {
    expect(confidenceFromQuality(9.5)).toBe(0.95);
    expect(confidenceFromQuality(9.0)).toBe(0.95);
  });

  it('maps clean-and-tight scores to the high bucket', () => {
    expect(confidenceFromQuality(8.8)).toBe(0.80);
    expect(confidenceFromQuality(8.0)).toBe(0.80);
  });

  it('maps meets-spec scores to medium, not high', () => {
    expect(confidenceFromQuality(7.9)).toBe(0.65);
    expect(confidenceFromQuality(7.0)).toBe(0.65);
  });

  it('maps a bare pass just clear of the extraction filter, in the medium bucket', () => {
    // CONFIDENCE_THRESHOLD in extract-skills.ts is 0.5, so 0.55 clears it without sitting on
    // the boundary the way a naive weightedScore/10 (5.0 -> 0.50) would.
    expect(confidenceFromQuality(5.1)).toBe(0.55);
    expect(confidenceFromQuality(5.0)).toBe(0.55);
    expect(confidenceFromQuality(5.0)).toBeGreaterThan(0.5);
  });

  it('keeps a card that FAILED the quality gate below the extraction filter', () => {
    expect(confidenceFromQuality(4.9)).toBeLessThan(0.5);
    expect(confidenceFromQuality(1.0)).toBeLessThan(0.5);
  });

  it('keeps an UNSCORED card below the extraction filter rather than at the ceiling', () => {
    // The old behaviour gave a null quality score confidence 1.0 — an unscored card produced a
    // high-confidence skill, the inverse of the intent.
    expect(confidenceFromQuality(null)).toBeLessThan(0.5);
    expect(confidenceFromQuality(undefined)).toBeLessThan(0.5);
    expect(confidenceFromQuality(Number.NaN)).toBeLessThan(0.5);
  });

  it('never returns a value outside 0..1', () => {
    for (const s of [null, undefined, Number.NaN, -5, 0, 1, 4.9, 5, 7, 8, 9, 10, 99]) {
      const c = confidenceFromQuality(s as number | null | undefined);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('DISCRIMINATES: a bare-pass card and a reference card differ (the whole point)', () => {
    expect(confidenceFromQuality(5.1)).not.toBe(confidenceFromQuality(9.5));
  });

  it('PRE-FIX constant did NOT discriminate (proves this is a regression test)', () => {
    const preFix = (_score: number | null) => 1.0; // the old SYNTHESIS_CONFIDENCE
    expect(preFix(5.1)).toBe(preFix(9.5));
    expect(preFix(null)).toBe(1.0);
    // and the pre-fix value would have cleared the 0.5 filter and hit the 0.75 'high' bucket
    expect(preFix(null)).toBeGreaterThan(0.75);
    expect(confidenceFromQuality(null)).toBeLessThan(0.75);
  });

  it('is monotonic: a better score never yields lower confidence', () => {
    const scores = [5, 5.1, 6, 7, 7.9, 8, 8.8, 9, 9.5, 10];
    const conf = scores.map((s) => confidenceFromQuality(s));
    for (let i = 1; i < conf.length; i++) {
      expect(conf[i]).toBeGreaterThanOrEqual(conf[i - 1]!);
    }
  });
});

describe('synthesiseHistoryEntry — confidence reflects the card that closed', () => {
  const q = (weightedScore: number | null): QualityScoreRow => ({ ...baseQuality, weightedScore });

  it('a 9.5 card synthesises higher confidence than a 5.1 card', () => {
    const strong = synthesiseHistoryEntry(baseCard, q(9.5), 'Volundr Meta');
    const weak = synthesiseHistoryEntry(baseCard, q(5.1), 'Volundr Meta');
    expect(strong!.confidence).toBeGreaterThan(weak!.confidence);
  });

  it('a null quality score no longer yields maximum confidence', () => {
    const unscored = synthesiseHistoryEntry(baseCard, null, 'Volundr Meta');
    expect(unscored).not.toBeNull();
    expect(unscored!.confidence).toBeLessThan(0.5);
  });

  it('still renders the quality segment in the body when a score exists', () => {
    const result = synthesiseHistoryEntry(baseCard, q(8.8), 'Volundr Meta');
    expect(result!.content).toContain('weighted=8.8');
    // the number is now used for BOTH the body and the confidence, not just the body
    expect(result!.confidence).toBe(0.80);
  });
});
