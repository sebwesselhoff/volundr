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
const SYNTHESIS_CONFIDENCE = 1.0;

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
    confidence: SYNTHESIS_CONFIDENCE,
    source: 'card-close',
  };
}
