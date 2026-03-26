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
 */

// ---- Constants ----------------------------------------------------------------

/** Fraction of confidence lost per day without reinforcement (≈ half-life ~30 days). */
const DECAY_RATE_PER_DAY = 0.023;

/** Entries with confidence below this value are considered stale and archived. */
const ARCHIVE_THRESHOLD = 0.2;

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
