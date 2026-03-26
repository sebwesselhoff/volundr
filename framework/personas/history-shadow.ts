/**
 * History Shadow System
 *
 * Manages the DB-backed persona history layer: stack-tagged entries, confidence
 * decay over time, and archival of stale entries.
 *
 * Confidence model:
 *   - Every entry starts at confidence = 1.0
 *   - Decays by DECAY_RATE per day since lastReinforcedAt
 *   - Reinforcement (the same pattern re-appears in a new card) resets to 1.0
 *   - Entries below ARCHIVE_THRESHOLD are archived (hidden from active history)
 *
 * Summarization model:
 *   - When total history size exceeds SUMMARIZATION_THRESHOLD_BYTES, the oldest
 *     non-core_context entries are condensed into a single core_context entry.
 *   - The Core Context section is kept under CORE_CONTEXT_CEILING_BYTES.
 *   - Stack tags are preserved in condensed entries.
 *
 * Contradiction detection:
 *   - Before appending a new entry, the system checks all active entries for
 *     keyword+negation overlap.
 *   - Conflicts are returned as ContradictionWarning objects for caller review.
 */

// ---- Constants ----------------------------------------------------------------

/** Fraction of confidence lost per day without reinforcement (≈ half-life ~30 days). */
const DECAY_RATE_PER_DAY = 0.023;

/** Entries with confidence below this value are considered stale and archived. */
const ARCHIVE_THRESHOLD = 0.2;

/** Total history byte size above which summarization is triggered. */
const SUMMARIZATION_THRESHOLD_BYTES = 8_000;

/** Maximum byte size for the Core Context section after condensation. */
const CORE_CONTEXT_CEILING_BYTES = 4_000;

/** Negation patterns that indicate a contradiction when paired with keyword overlap. */
const NEGATION_PATTERNS = [
  /\bnever\b/i,
  /\bnot\b/i,
  /\bdon't\b/i,
  /\bdo not\b/i,
  /\bavoid\b/i,
  /\bstop\b/i,
  /\brefuse\b/i,
  /\balways\b/i, // "always X" vs "never X"
];

// ---- Types --------------------------------------------------------------------

export type HistoryEntryType = 'learning' | 'decision' | 'pattern' | 'core_context';

export interface HistoryEntry {
  id: number;
  personaId: string;
  entryType: HistoryEntryType;
  content: string;
  projectId: string | null;
  projectName: string | null;
  cardId: string | null;
  /** Parsed from the JSON string stored in DB */
  stackTags: string[];
  confidence: number;
  lastReinforcedAt: string;
  archived: boolean;
  createdAt: string;
}

export interface CreateHistoryEntryInput {
  personaId: string;
  entryType: HistoryEntryType;
  content: string;
  projectId?: string;
  projectName?: string;
  cardId?: string;
  stackTags?: string[];
}

// ---- Confidence helpers -------------------------------------------------------

/**
 * Compute the decayed confidence for an entry given its last reinforcement
 * timestamp and the current time.
 */
export function decayedConfidence(
  initialConfidence: number,
  lastReinforcedAt: string,
  now: Date = new Date(),
): number {
  const lastMs = new Date(lastReinforcedAt).getTime();
  const elapsedDays = (now.getTime() - lastMs) / (1000 * 60 * 60 * 24);
  const decayed = initialConfidence * Math.pow(1 - DECAY_RATE_PER_DAY, elapsedDays);
  return Math.max(0, decayed);
}

/**
 * Returns true if an entry's current decayed confidence is below the archive
 * threshold and should be archived.
 */
export function shouldArchive(entry: Pick<HistoryEntry, 'confidence' | 'lastReinforcedAt'>): boolean {
  const current = decayedConfidence(entry.confidence, entry.lastReinforcedAt);
  return current < ARCHIVE_THRESHOLD;
}

// ---- Stack tag helpers -------------------------------------------------------

/** Extract stack tags from a history entry's content by matching bracket notation. */
export function extractStackTags(content: string): string[] {
  const matches = content.match(/\[([a-z0-9._-]+)\]/gi) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1).toLowerCase()))];
}

/** Filter entries by stack tag (case-insensitive). */
export function filterByStackTag(entries: HistoryEntry[], tag: string): HistoryEntry[] {
  const lower = tag.toLowerCase();
  return entries.filter((e) => e.stackTags.some((t) => t === lower));
}

// ---- Serialisation helpers ---------------------------------------------------

/** Parse stack_tags JSON string from DB into a string array. */
export function parseStackTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Serialise a string array for storage in the DB stack_tags column. */
export function serialiseStackTags(tags: string[]): string {
  return JSON.stringify(tags);
}

// ---- Summarization -----------------------------------------------------------

/**
 * Compute the approximate byte size of a list of history entries.
 * Uses content length as a proxy for UTF-8 byte size (good enough for
 * threshold comparisons; exact byte counts not needed here).
 */
export function historyByteSize(entries: HistoryEntry[]): number {
  return entries.reduce((sum, e) => sum + e.content.length, 0);
}

/**
 * Returns true if the combined size of active entries exceeds the
 * summarization threshold and condensation should be triggered.
 */
export function needsSummarization(entries: HistoryEntry[]): boolean {
  const active = entries.filter((e) => !e.archived);
  return historyByteSize(active) > SUMMARIZATION_THRESHOLD_BYTES;
}

/**
 * Result of condensing a set of history entries into a compact summary.
 */
export interface CondensationResult {
  /**
   * The condensed text to store as a new core_context entry.
   * Combines all unique stack tags from the source entries.
   */
  condensedContent: string;
  /** Union of all stack tags from the condensed entries. */
  preservedTags: string[];
  /** IDs of the entries that were condensed (to be archived by the caller). */
  condensedIds: number[];
}

/**
 * Condense the oldest entries (non-core_context) into a compact summary string.
 * The caller is responsible for archiving the condensed entries and persisting
 * the resulting core_context entry to the DB.
 *
 * Strategy:
 *   1. Select the oldest N entries (non-core_context, not archived) until total
 *      size of remaining active entries fits within CORE_CONTEXT_CEILING_BYTES.
 *   2. Build a bulleted summary preserving per-entry project and date context.
 *   3. Collect all stack tags from condensed entries.
 *
 * @param entries  All active (non-archived) history entries, sorted by createdAt asc.
 */
export function condenseOldestEntries(entries: HistoryEntry[]): CondensationResult {
  const active = entries.filter((e) => !e.archived && e.entryType !== 'core_context');
  // Sort oldest first
  const sorted = [...active].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const toCondense: HistoryEntry[] = [];
  let totalSize = historyByteSize(active);

  for (const entry of sorted) {
    if (totalSize <= CORE_CONTEXT_CEILING_BYTES) break;
    toCondense.push(entry);
    totalSize -= entry.content.length;
  }

  if (toCondense.length === 0) {
    return { condensedContent: '', preservedTags: [], condensedIds: [] };
  }

  const lines = toCondense.map((e) => {
    const date = e.createdAt.slice(0, 10);
    const project = e.projectName ?? e.projectId ?? 'unknown';
    const tags = e.stackTags.map((t) => `[${t}]`).join(' ');
    const tagPart = tags ? ` ${tags}` : '';
    return `- (${e.entryType}) ${date} / ${project}${tagPart}: ${e.content}`;
  });

  const condensedContent = `Condensed from ${toCondense.length} entries:\n${lines.join('\n')}`;
  const preservedTags = [...new Set(toCondense.flatMap((e) => e.stackTags))];
  const condensedIds = toCondense.map((e) => e.id);

  return { condensedContent, preservedTags, condensedIds };
}

// ---- Contradiction detection --------------------------------------------------

export interface ContradictionWarning {
  /** The candidate entry being appended. */
  candidate: Pick<HistoryEntry, 'content' | 'entryType'>;
  /** The existing entry that conflicts. */
  existingId: number;
  existingContent: string;
  /** Keywords that overlap between the two entries. */
  sharedKeywords: string[];
}

/**
 * Extract meaningful keywords from a content string (lowercase words ≥4 chars,
 * stop-word filtered).
 */
function extractKeywords(content: string): string[] {
  const stopWords = new Set([
    'that', 'this', 'with', 'from', 'have', 'will', 'when', 'then',
    'they', 'them', 'been', 'were', 'also', 'more', 'into', 'over',
    'after', 'before', 'should', 'would', 'could', 'always', 'never',
  ]);
  return content
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
}

/**
 * Returns true if a text contains a negation pattern.
 */
function hasNegation(content: string): boolean {
  return NEGATION_PATTERNS.some((p) => p.test(content));
}

/**
 * Detect potential contradictions between a candidate entry and a list of
 * existing active entries.
 *
 * A contradiction is flagged when:
 *   - The candidate and an existing entry share ≥2 significant keywords, AND
 *   - Exactly one of the two contains a negation pattern (e.g. one says
 *     "always X", the other says "never X").
 *
 * Callers should review ContradictionWarning objects and decide whether to
 * supersede or keep both entries.
 */
export function detectContradictions(
  candidate: Pick<HistoryEntry, 'content' | 'entryType'>,
  existing: HistoryEntry[],
): ContradictionWarning[] {
  const warnings: ContradictionWarning[] = [];
  const candidateKeywords = new Set(extractKeywords(candidate.content));
  const candidateHasNegation = hasNegation(candidate.content);

  for (const entry of existing) {
    if (entry.archived) continue;

    const entryKeywords = extractKeywords(entry.content);
    const shared = entryKeywords.filter((k) => candidateKeywords.has(k));

    if (shared.length < 2) continue;

    const entryHasNegation = hasNegation(entry.content);
    // Flag only when one side negates and the other doesn't
    if (candidateHasNegation !== entryHasNegation) {
      warnings.push({
        candidate,
        existingId: entry.id,
        existingContent: entry.content,
        sharedKeywords: shared,
      });
    }
  }

  return warnings;
}

// ---- Stack tag filtering -----------------------------------------------------

/**
 * Filter entries by a set of stack tags.
 * Entries with no stack tags are always included (they are considered global).
 * Entries with stack tags are included only if at least one tag matches.
 */
export function filterByStackTags(entries: HistoryEntry[], tags: string[]): HistoryEntry[] {
  if (tags.length === 0) return entries;
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  return entries.filter((e) => e.stackTags.length === 0 || e.stackTags.some((t) => lower.has(t)));
}

// ---- History.md generation ---------------------------------------------------

/**
 * Render active (non-archived) history entries into the history.md format
 * expected by charter-format.md.  Caller provides the sorted active entries
 * and the persona stats; this function only formats — it does not query the DB.
 */
export interface PersonaHistoryStats {
  projectsCount: number;
  cardsCount: number;
  qualityAvg: number | null;
}

export function renderHistoryMd(
  personaName: string,
  stats: PersonaHistoryStats,
  entries: HistoryEntry[],
): string {
  const { projectsCount, cardsCount, qualityAvg } = stats;
  const qualityStr = qualityAvg != null ? qualityAvg.toFixed(1) : '—';

  const byType = (type: HistoryEntryType) =>
    entries.filter((e) => e.entryType === type && !e.archived);

  const formatEntry = (e: HistoryEntry): string => {
    const date = e.createdAt.slice(0, 10);
    const project = e.projectName ?? e.projectId ?? 'unknown';
    const tags = e.stackTags.map((t) => `[${t}]`).join(' ');
    const tagPart = tags ? ` ${tags}` : '';
    return `### ${date} — ${project}${tagPart}\n${e.content}`;
  };

  const section = (title: string, items: HistoryEntry[]) => {
    if (items.length === 0) return `## ${title}\n`;
    return `## ${title}\n${items.map(formatEntry).join('\n\n')}\n`;
  };

  const coreContextEntries = byType('core_context');
  const coreContext =
    coreContextEntries.length > 0
      ? coreContextEntries.map((e) => e.content).join('\n')
      : 'No project history yet.';

  return [
    `# ${personaName} — Accumulated Knowledge`,
    '',
    `**Projects:** ${projectsCount} | **Cards:** ${cardsCount} | **Quality avg:** ${qualityStr}`,
    '',
    '## Core Context',
    coreContext,
    '',
    section('Learnings', byType('learning')),
    section('Decisions', byType('decision')),
    section('Patterns', byType('pattern')),
  ].join('\n');
}
