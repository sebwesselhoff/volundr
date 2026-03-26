/**
 * Pure helpers for persona history confidence decay and stack tagging.
 * Mirrors framework/personas/history-shadow.ts — the framework file is the
 * canonical reference; this copy exists so the API package stays within its
 * rootDir boundary (no imports outside src/).
 */

export type HistoryEntryType = 'learning' | 'decision' | 'pattern' | 'core_context';

const DECAY_RATE_PER_DAY = 0.023;
const ARCHIVE_THRESHOLD = 0.2;

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

export function shouldArchive(entry: {
  confidence: number;
  lastReinforcedAt: string;
}): boolean {
  return decayedConfidence(entry.confidence, entry.lastReinforcedAt) < ARCHIVE_THRESHOLD;
}

export function extractStackTags(content: string): string[] {
  const matches = content.match(/\[([a-z0-9._-]+)\]/gi) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1).toLowerCase()))];
}

export function parseStackTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serialiseStackTags(tags: string[]): string {
  return JSON.stringify(tags);
}
