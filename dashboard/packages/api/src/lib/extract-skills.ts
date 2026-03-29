/**
 * extract-skills.ts — cross-project learning extraction pipeline
 *
 * Promotes high-confidence persona history entries (learning/pattern type)
 * into reusable skill records in the skills table.
 *
 * Pipeline:
 *   1. Collect all active (non-archived) history entries of type learning/pattern
 *      for a persona that exceed the confidence threshold.
 *   2. Group entries by their stack tags (each unique tag combination = one candidate).
 *   3. For each candidate group, synthesise a skill record:
 *      - id:          derived from persona id + primary stack tag + counter
 *      - name:        first entry content (truncated) as the skill name
 *      - description: joined entry contents (truncated)
 *      - domain:      primary stack tag or 'general'
 *      - confidence:  average of entry confidences → mapped to low/medium/high
 *      - triggers:    stack tags + significant content keywords
 *      - roles:       persona role
 *      - body:        formatted learning entries
 *   4. Return skill input records — caller upserts to the DB.
 *
 * Deduplication: caller checks if a skill with the same id already exists
 * and increments version on update.
 */

import type { CreateSkillInput } from '@vldr/shared';

// ---- Types ------------------------------------------------------------------

export interface HistoryEntryInput {
  id: number;
  personaId: string;
  entryType: string;
  content: string;
  projectId: string | null;
  projectName: string | null;
  stackTags: string[];
  confidence: number;
  createdAt: string;
}

export interface ExtractionInput {
  personaId: string;
  personaRole: string;
  /** Active history entries (all types — filtered internally) */
  entries: HistoryEntryInput[];
  /** Minimum confidence to include an entry (default 0.5) */
  confidenceThreshold?: number;
  /** Maximum skills to extract per persona per run (default 10) */
  limit?: number;
}

export interface ExtractionResult {
  /** Skill records ready for DB upsert */
  skills: Array<CreateSkillInput & { existingId?: string; isUpdate: boolean }>;
  /** IDs of history entries that were included */
  includedEntryIds: number[];
}

// ---- Constants --------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.5;
const MAX_SKILLS_PER_RUN = 10;
const MIN_GROUP_SIZE = 1;

// ---- Helpers ----------------------------------------------------------------

function mapConfidenceLevel(avg: number): 'low' | 'medium' | 'high' {
  if (avg >= 0.75) return 'high';
  if (avg >= 0.4) return 'medium';
  return 'low';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Extract significant keywords from content for use as triggers. */
function extractKeywords(content: string, limit = 5): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'from', 'have',
    'will', 'when', 'then', 'they', 'them', 'been', 'were', 'also', 'more',
    'into', 'over', 'after', 'before', 'should', 'would', 'could',
  ]);
  const words = content
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));

  // Dedupe and return top N by length (longer = more specific)
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length);
  return unique.slice(0, limit);
}

function formatSkillBody(entries: HistoryEntryInput[]): string {
  const lines = entries.map((e) => {
    const date = e.createdAt.slice(0, 10);
    const project = e.projectName ?? e.projectId ?? 'unknown';
    return `- (${e.entryType}, ${date}, ${project}): ${e.content}`;
  });
  return `## Extracted Learnings\n\n${lines.join('\n')}`;
}

// ---- Main -------------------------------------------------------------------

/**
 * Extract skill records from persona history entries.
 * Groups by primary stack tag; falls back to 'general' for untagged entries.
 */
export function extractSkillsFromHistory(input: ExtractionInput): ExtractionResult {
  const {
    personaId,
    personaRole,
    entries,
    confidenceThreshold = CONFIDENCE_THRESHOLD,
    limit = MAX_SKILLS_PER_RUN,
  } = input;

  // Filter to qualifying learning/pattern entries above confidence threshold
  const eligible = entries.filter(
    (e) =>
      (e.entryType === 'learning' || e.entryType === 'pattern') &&
      e.confidence >= confidenceThreshold,
  );

  if (eligible.length === 0) {
    return { skills: [], includedEntryIds: [] };
  }

  // Group by primary stack tag (first tag, or 'general')
  const groups = new Map<string, HistoryEntryInput[]>();
  for (const entry of eligible) {
    const primaryTag = entry.stackTags[0] ?? 'general';
    if (!groups.has(primaryTag)) groups.set(primaryTag, []);
    groups.get(primaryTag)!.push(entry);
  }

  const skillInputs: Array<CreateSkillInput & { existingId?: string; isUpdate: boolean }> = [];
  const includedEntryIds: number[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsLater = new Date(Date.now() + 182 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const [tag, groupEntries] of groups) {
    if (groupEntries.length < MIN_GROUP_SIZE) continue;
    if (skillInputs.length >= limit) break;

    const avgConfidence =
      groupEntries.reduce((sum, e) => sum + e.confidence, 0) / groupEntries.length;
    const confidence = mapConfidenceLevel(avgConfidence);

    // Build skill id: persona-tag-extracted
    const skillId = `${slugify(personaId)}-${slugify(tag)}-extracted`;

    // Combine content keywords from all entries for triggers
    const allKeywords = groupEntries.flatMap((e) => extractKeywords(e.content, 3));
    const triggerSet = [...new Set([tag, ...allKeywords])].slice(0, 8);

    // Build name from the first entry's content (first sentence)
    const firstContent = groupEntries[0].content;
    const firstSentence = firstContent.split(/[.!?]/)[0].trim();
    const name = firstSentence.length > 60
      ? firstSentence.slice(0, 57) + '...'
      : firstSentence;

    // Description: join all content with truncation
    const description = groupEntries
      .map((e) => e.content)
      .join(' ')
      .slice(0, 200)
      .replace(/\s+/g, ' ')
      .trim();

    const body = formatSkillBody(groupEntries);

    skillInputs.push({
      id: skillId,
      name: name || `Extracted: ${tag}`,
      description: description || `Learned patterns for ${tag}`,
      domain: tag,
      confidence,
      source: 'extracted',
      version: 1,
      validatedAt: today,
      reviewByDate: sixMonthsLater,
      triggers: triggerSet,
      roles: [personaRole],
      body,
      isUpdate: false,
    });

    for (const e of groupEntries) {
      includedEntryIds.push(e.id);
    }
  }

  return { skills: skillInputs, includedEntryIds };
}
