/**
 * persona-history-synth.ts — Pure helper that synthesises a persona_history row
 * body from a card + quality_score at the moment the card is closed.
 *
 * This module has NO database calls — it is purely a data-transformation function
 * so that unit tests can exercise it without any DB setup.
 *
 * The generated row is marked source='card-close' and uses entryType='learning'
 * so it flows through the existing extractSkillsFromHistory pipeline unchanged.
 */

import { extractStackTags, serialiseStackTags } from './persona-history.js';

// ---- Input types (mirror DB row shapes) -------------------------------------

export interface CardRow {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  filesCreated: string | null;   // JSON string[] stored in DB
  filesModified: string | null;  // JSON string[] stored in DB
  isc: string | null;            // JSON array stored in DB
  assignedPersonaId: string | null;
}

export interface QualityScoreRow {
  completeness: number | null;
  codeQuality: number | null;
  formatCompliance: number | null;
  correctness: number | null;
  weightedScore: number | null;
  implementationType: string | null;
  reviewType: string | null;
}

export interface IscEntry {
  criterion: string;
  passed: boolean | null;
  evidence: string | null;
}

// ---- Output type -------------------------------------------------------------

export interface SynthesisPayload {
  personaId: string;
  entryType: 'learning';
  content: string;
  projectId: string;
  projectName: string;
  cardId: string;
  stackTags: string; // serialised JSON string[]
  confidence: number;
  source: 'card-close';
}

// ---- Constants --------------------------------------------------------------

const MAX_DESCRIPTION_CHARS = 400;

/**
 * FRW-BL-096 — this was `SYNTHESIS_CONFIDENCE = 1.0`, written unconditionally.
 *
 * Consequence: every card-close row entered extractSkillsFromHistory at the ceiling, always
 * cleared its CONFIDENCE_THRESHOLD (0.5) filter, and always landed in the 'high' bucket
 * (mapConfidenceLevel: >= 0.75). A card scraping past the 5.0 quality gate at 5.1 produced the
 * same "high-confidence" skill as one closing at 9.5, and an UNSCORED card produced one too. The
 * threshold and the low/medium/high mapping were dead code on the common path — and this IS the
 * common path, since flat / Volundr-direct work relies on card-close synthesis (see
 * system-instructions § Persona linkage in flat/Volundr-direct mode).
 *
 * The quality score was already a parameter of the synthesis function: it was rendered into the
 * human-readable body and then discarded. Nothing needed plumbing in; only mapping.
 *
 * Bands are anchored to the blind-reviewer rubric in framework/packs/quality/prompts/card-reviewer.md
 * ("6-7 meets the spec — the baseline for a completed card", "8 clean, well-structured, follows
 * conventions tightly", "9 genuinely impressive — a reference implementation") rather than a
 * formula, so each boundary is explainable. A naive weightedScore/10 was rejected: it puts a bare
 * 5.0 pass exactly ON the >= 0.5 filter boundary, and promotes 7.5 to 'high', which the rubric does
 * not consider clean yet.
 */
const CONFIDENCE_UNSCORED = 0.2; // below CONFIDENCE_THRESHOLD by design → seeds no skill
const CONFIDENCE_BELOW_GATE = 0.3; // failed the 5.0 quality gate → seeds no skill
const CONFIDENCE_BANDS: ReadonlyArray<{ minScore: number; confidence: number }> = [
  { minScore: 9.0, confidence: 0.95 }, // reference quality
  { minScore: 8.0, confidence: 0.80 }, // clean, tight → 'high'
  { minScore: 7.0, confidence: 0.65 }, // solidly meets spec → 'medium'
  { minScore: 5.0, confidence: 0.55 }, // bare pass → 'medium', just clear of the filter
];

/**
 * Map a weighted quality score (1-10) to a persona_history confidence (0-1).
 * Exported for testing: the bands are a deliberate calibration, so they are asserted directly.
 */
export function confidenceFromQuality(weightedScore: number | null | undefined): number {
  if (weightedScore == null || !Number.isFinite(weightedScore)) return CONFIDENCE_UNSCORED;
  for (const band of CONFIDENCE_BANDS) {
    if (weightedScore >= band.minScore) return band.confidence;
  }
  return CONFIDENCE_BELOW_GATE;
}

// ---- Helper -----------------------------------------------------------------

function safeParseJson<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// ---- Main export ------------------------------------------------------------

/**
 * Build the body of a synthetic persona_history entry.
 *
 * @param card         The card row as stored in the DB (filesCreated/filesModified are JSON strings).
 * @param qualityScore The quality_score row (may be null if scoring was skipped — unlikely but defensive).
 * @param projectName  Resolved project name (passed in because the card row does not store it).
 * @returns            A SynthesisPayload ready for DB insert, or null if personaId is falsy.
 */
export function synthesiseHistoryEntry(
  card: CardRow,
  qualityScore: QualityScoreRow | null,
  projectName: string,
): SynthesisPayload | null {
  if (!card.assignedPersonaId) return null;

  const filesCreated: string[] = safeParseJson<string>(card.filesCreated);
  const filesModified: string[] = safeParseJson<string>(card.filesModified);
  const iscEntries: IscEntry[] = safeParseJson<IscEntry>(card.isc);

  // Build file list segment
  const allFiles = [...filesCreated, ...filesModified];
  const filesSegment = allFiles.length > 0
    ? `Files: ${allFiles.join(', ')}.`
    : '';

  // Build ISC segment — flatten to one line
  const iscSegment = iscEntries.length > 0
    ? `ISC: ${iscEntries
        .map((c) => `${c.criterion} → ${c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'pending'}${c.evidence ? ` (${c.evidence})` : ''}`)
        .join(' | ')}.`
    : '';

  // Build quality segment
  let qualitySegment = '';
  if (qualityScore) {
    const { completeness: c, codeQuality: q, formatCompliance: f, correctness: r, weightedScore: w, reviewType } = qualityScore;
    qualitySegment = `Quality: completeness=${c ?? 'n/a'}, codeQuality=${q ?? 'n/a'}, formatCompliance=${f ?? 'n/a'}, correctness=${r ?? 'n/a'}, weighted=${w != null ? w.toFixed(1) : 'n/a'} (${reviewType ?? 'self'}).`;
  }

  // Truncate description
  const rawDesc = card.description ?? '';
  const descTruncated = rawDesc.length > MAX_DESCRIPTION_CHARS
    ? rawDesc.slice(0, MAX_DESCRIPTION_CHARS) + '…'
    : rawDesc;
  const descSegment = descTruncated ? `Description: ${descTruncated}` : '';

  // Assemble content
  const parts = [
    `Completed ${card.id}: ${card.title}.`,
    filesSegment,
    iscSegment,
    qualitySegment,
    descSegment,
  ].filter(Boolean);
  const content = parts.join('\n');

  const tags = extractStackTags(content);
  const stackTags = serialiseStackTags(tags);

  return {
    personaId: card.assignedPersonaId,
    entryType: 'learning',
    content,
    projectId: card.projectId,
    projectName,
    cardId: card.id,
    stackTags,
    confidence: confidenceFromQuality(qualityScore?.weightedScore),
    source: 'card-close',
  };
}
