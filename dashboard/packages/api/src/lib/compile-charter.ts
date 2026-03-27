/**
 * compile-charter.ts — API-local charter compilation for persona spawn
 *
 * Mirrors the layer pipeline from framework/personas/charter-compiler.ts.
 * Lives in the API package to respect rootDir boundaries.
 *
 * Pipeline:
 *   1 IdentityLayer   — charter.md content               ceiling: 1 500 B
 *   2 ConstraintsLayer — project constraints.md          ceiling: 2 000 B
 *   3 SteeringLayer   — steering rules from constraints  ceiling: 1 000 B
 *   4 DirectivesLayer — active directives               ceiling:   500 B
 *   5 SkillsLayer     — top skills with full body        ceiling: 2 000 B
 *   6 HistoryLayer    — DB history entries               ceiling: 1 500 B
 *   7 CardLayer       — current card context             ceiling: 3 000 B
 *   8 TraitsLayer     — persona traits                   ceiling:   500 B
 */

// ---- Byte ceiling helper -----------------------------------------------------

function truncateToBytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return text;
  const cut = encoded.slice(0, maxBytes);
  const decoded = new TextDecoder().decode(cut);
  const lastNl = decoded.lastIndexOf('\n');
  return lastNl > 0 ? decoded.slice(0, lastNl) + '\n…(truncated)' : decoded + '\n…(truncated)';
}

// ---- Types -------------------------------------------------------------------

export interface CompileCharterInput {
  /** Raw charter.md text */
  charterMd: string;
  /** Raw constraints.md text for the active project (may be empty) */
  constraintsMd: string;
  /** Active directives: global first, then project-scoped */
  directives: Array<{ id: number; content: string; projectId: string | null; priority: number }>;
  /** Skills to inject (full body included) */
  skills: Array<{
    id: string;
    name: string;
    description: string;
    domain: string;
    confidence: 'low' | 'medium' | 'high';
    body: string;
  }>;
  /** Active (non-archived) history entries, pre-sorted or unsorted */
  historyEntries: Array<{
    id: number;
    entryType: string;
    content: string;
    projectId: string | null;
    projectName: string | null;
    stackTags: string[];
    confidence: number;
    createdAt: string;
  }>;
  /** Persona stats for history header */
  stats: { projectsCount: number; cardsCount: number; qualityAvg: number | null };
  /** Current card spec text (may be empty) */
  cardContext: string;
  /** Persona traits to inject (may be empty) */
  traits: string[];
  /** Optional stack tags from the current card — used for relevance sorting */
  cardStackTags?: string[];
}

// ---- Layer implementations ---------------------------------------------------

const CEILINGS = {
  identity:     1_500,
  constraints:  2_000,
  steering:     1_000,
  directives:     500,
  skills:       2_000,
  history:      1_500,
  card:         3_000,
  traits:         500,
};

function identityLayer(charterMd: string): string {
  return charterMd
    .replace(/^## Skills\n- \(populated dynamically.*?\n?/m, '')
    .trimEnd();
}

function constraintsLayer(constraintsMd: string): string {
  if (!constraintsMd.trim()) return '';
  const steeringIdx = constraintsMd.indexOf('## Steering Rules');
  const body = steeringIdx > 0
    ? constraintsMd.slice(0, steeringIdx).trimEnd()
    : constraintsMd.trimEnd();
  if (!body.trim()) return '';
  return `## Project Constraints\n\n${body}`;
}

function steeringLayer(constraintsMd: string): string {
  if (!constraintsMd.trim()) return '';
  const steeringIdx = constraintsMd.indexOf('## Steering Rules');
  if (steeringIdx < 0) return '';
  const steeringSection = constraintsMd.slice(steeringIdx);
  const ruleLines = steeringSection
    .split('\n')
    .filter((l) => l.trim().startsWith('-') && !l.includes('[SUPPRESSED]'))
    .slice(-5);
  if (ruleLines.length === 0) return '';
  return `## Steering Rules\n${ruleLines.join('\n')}`;
}

function directivesLayer(
  directives: CompileCharterInput['directives'],
): string {
  if (directives.length === 0) return '';
  const sorted = [...directives].sort((a, b) => {
    const aGlobal = a.projectId == null ? 0 : 1;
    const bGlobal = b.projectId == null ? 0 : 1;
    if (aGlobal !== bGlobal) return aGlobal - bGlobal;
    return b.priority - a.priority;
  });
  const lines = sorted.map((d) => `- ${d.content}`);
  return `## Standing Directives\n${lines.join('\n')}`;
}

function skillsLayer(
  skills: CompileCharterInput['skills'],
  cardStackTags?: string[],
): string {
  if (skills.length === 0) return '';
  const domainHints = new Set((cardStackTags ?? []).map((t) => t.toLowerCase()));
  const confOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...skills].sort((a, b) => {
    const aMatch = domainHints.has(a.domain.toLowerCase()) ? 0 : 1;
    const bMatch = domainHints.has(b.domain.toLowerCase()) ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (confOrder[a.confidence] ?? 1) - (confOrder[b.confidence] ?? 1);
  });
  const blocks = sorted.map(
    (s) => `### ${s.name} *(${s.domain}, ${s.confidence})*\n${s.description}\n\n${s.body.trim()}`,
  );
  return `## Skills\n\n${blocks.join('\n\n---\n\n')}`;
}

function historyLayer(
  entries: CompileCharterInput['historyEntries'],
  stats: CompileCharterInput['stats'],
  cardStackTags?: string[],
): string {
  if (entries.length === 0) return '';

  const stackMatches = new Set(cardStackTags ?? []);
  const sorted = [...entries].sort((a, b) => {
    const aMatch = a.stackTags.some((t) => stackMatches.has(t)) ? 1 : 0;
    const bMatch = b.stackTags.some((t) => stackMatches.has(t)) ? 1 : 0;
    if (bMatch !== aMatch) return bMatch - aMatch;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
  const capped = sorted.slice(0, 20);

  const byType = (type: string) => capped.filter((e) => e.entryType === type);

  const fmtEntry = (e: (typeof capped)[0]): string => {
    const date = e.createdAt.slice(0, 10);
    const project = e.projectName ?? e.projectId ?? 'unknown';
    const tags = e.stackTags.map((t) => `[${t}]`).join(' ');
    const tagPart = tags ? ` ${tags}` : '';
    return `- **${date} — ${project}${tagPart}:** ${e.content}`;
  };

  const sectionBlock = (title: string, items: (typeof capped)) =>
    items.length > 0 ? `### ${title}\n${items.map(fmtEntry).join('\n')}` : '';

  const qualityStr = stats.qualityAvg != null ? stats.qualityAvg.toFixed(1) : '—';
  const header =
    `## Accumulated Knowledge\n` +
    `> Projects: ${stats.projectsCount} | Cards: ${stats.cardsCount} | Quality avg: ${qualityStr}`;

  const coreCtx = byType('core_context');
  const coreSection = coreCtx.length > 0
    ? `### Core Context\n${coreCtx.map((e) => e.content).join('\n')}`
    : '';

  const parts = [
    header,
    coreSection,
    sectionBlock('Learnings', byType('learning')),
    sectionBlock('Decisions', byType('decision')),
    sectionBlock('Patterns', byType('pattern')),
  ].filter(Boolean);

  return parts.join('\n\n');
}

function cardLayer(cardContext: string): string {
  if (!cardContext.trim()) return '';
  return `## Current Card\n\n${cardContext.trim()}`;
}

function traitsLayer(traits: string[]): string {
  if (traits.length === 0) return '';
  return `## Traits\n${traits.map((t) => `- ${t}`).join('\n')}`;
}

// ---- Main compile function ---------------------------------------------------

/**
 * Compile a full persona system prompt from the provided context.
 * All sections are byte-capped and separated by horizontal rules.
 */
export function compileCharter(input: CompileCharterInput): string {
  const {
    charterMd,
    constraintsMd,
    directives,
    skills,
    historyEntries,
    stats,
    cardContext,
    traits,
    cardStackTags,
  } = input;

  const layers: Array<{ text: string; ceiling: number }> = [
    { text: identityLayer(charterMd),                               ceiling: CEILINGS.identity },
    { text: constraintsLayer(constraintsMd),                        ceiling: CEILINGS.constraints },
    { text: steeringLayer(constraintsMd),                           ceiling: CEILINGS.steering },
    { text: directivesLayer(directives),                            ceiling: CEILINGS.directives },
    { text: skillsLayer(skills, cardStackTags),                     ceiling: CEILINGS.skills },
    { text: historyLayer(historyEntries, stats, cardStackTags),     ceiling: CEILINGS.history },
    { text: cardLayer(cardContext),                                  ceiling: CEILINGS.card },
    { text: traitsLayer(traits),                                    ceiling: CEILINGS.traits },
  ];

  const sections: string[] = [];
  for (const { text, ceiling } of layers) {
    const raw = text.trim();
    if (!raw) continue;
    sections.push(truncateToBytes(raw, ceiling));
  }

  return sections.join('\n\n---\n\n');
}
