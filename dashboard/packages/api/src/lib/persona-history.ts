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

const KNOWN_STACK_TAGS = new Set([
  'react', 'vue', 'svelte', 'angular', 'next', 'nextjs', 'nuxt', 'astro', 'vite',
  'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'csharp', 'ruby',
  'node', 'nodejs', 'deno', 'bun', 'express', 'fastify', 'hono', 'koa',
  'tailwind', 'css', 'sass', 'styled-components',
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'drizzle', 'prisma',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'vercel', 'cloudflare',
  'canvas2d', 'webgl', 'pixi', 'three', 'svg',
  'dnd-kit', 'react-dnd', 'drag-and-drop',
  'jest', 'vitest', 'playwright', 'cypress', 'testing',
  'graphql', 'rest', 'grpc', 'websocket', 'trpc',
  'auth', 'jwt', 'oauth', 'security', 'encryption',
  'git', 'ci', 'cd', 'github', 'gitlab',
]);

export function extractStackTags(content: string): string[] {
  // First: explicit [tag] bracket syntax
  const bracketMatches = content.match(/\[([a-z0-9._-]+)\]/gi) ?? [];
  const tags = bracketMatches.map((m) => m.slice(1, -1).toLowerCase());

  // Second: match known tech keywords as whole tokens (prevents 'rest' matching 'interest')
  const lower = content.toLowerCase();
  const words = lower.match(/[a-z0-9._-]+/g) ?? [];
  for (const word of words) {
    if (KNOWN_STACK_TAGS.has(word)) tags.push(word);
  }

  return [...new Set(tags)];
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
