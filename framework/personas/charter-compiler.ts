/**
 * Charter Compiler
 *
 * Builds the system prompt for an activated persona by running a pipeline of
 * CompilerLayers in order.  Each layer receives a shared context and emits a
 * markdown string that is appended to the final output.
 *
 * Layer ordering (stable first for prompt-cache efficiency):
 *   1 — IdentityLayer      charter.md static content            ceiling: 1 500 B
 *   2 — ConstraintsLayer   project constraints.md               ceiling: 2 000 B
 *   3 — SteeringLayer      steering rules from constraints.md   ceiling: 1 000 B
 *   4 — DirectivesLayer    active directives (global+project)   ceiling:   500 B
 *   5 — SkillsLayer        top-N skills with full body          ceiling: 2 000 B
 *   6 — HistoryLayer       accumulated knowledge from DB        ceiling: 1 500 B
 *   7 — CardLayer          current card spec / context          ceiling: 3 000 B
 *   8 — TraitsLayer        persona traits                       ceiling:   500 B
 *
 * Total budget: ~12 500 B
 *
 * Usage:
 *   const compiler = new CharterCompiler([
 *     new IdentityLayer(),
 *     new ConstraintsLayer(),
 *     new SteeringLayer(),
 *     new DirectivesLayer(),
 *     new SkillsLayer(),
 *     new HistoryLayer(),
 *     new CardLayer(),
 *     new TraitsLayer(),
 *   ]);
 *   const prompt = await compiler.compile(ctx);
 */

// ---- Byte-ceiling helper -----------------------------------------------------

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes.
 * Cuts at the last newline within range to avoid mid-line truncation.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return text;
  const cut = encoded.slice(0, maxBytes);
  const decoded = new TextDecoder().decode(cut);
  // Walk back to last newline for a clean cut
  const lastNl = decoded.lastIndexOf('\n');
  return lastNl > 0 ? decoded.slice(0, lastNl) + '\n…(truncated)' : decoded + '\n…(truncated)';
}

// ---- CompilerLayer interface --------------------------------------------------

export interface CompilerContext {
  /** The persona id, e.g. "fullstack-web" */
  personaId: string;
  /** Raw charter.md text loaded from disk */
  charterMd: string;
  /** Active (non-archived) history entries, already decayed */
  historyEntries: HistoryEntry[];
  /** Persona stats for history header */
  stats: PersonaHistoryStats;
  /** Skills to inject — list of full skill records (body content included) */
  skills: SkillRecord[];
  /** Active directives for the current project */
  directives: DirectiveSummary[];
  /** Raw constraints.md text for the current project (may be empty) */
  constraintsMd: string;
  /** Current card spec / context text (may be empty) */
  cardContext: string;
  /** Persona traits to inject (may be empty) */
  traits: string[];
  /**
   * Optional stack context for the current card.
   * Used by layers that can filter by stack tag.
   */
  cardStackTags?: string[];
  /**
   * Free-form metadata that layers can attach for downstream layers to read.
   * Layers should namespace their keys to avoid collisions.
   */
  meta: Record<string, unknown>;
}

export interface CompilerLayerResult {
  /** The markdown string this layer contributes to the final prompt. */
  section: string;
  /** Any metadata the layer wants to expose to subsequent layers. */
  meta?: Record<string, unknown>;
}

/**
 * A CompilerLayer transforms the current context into a prompt section.
 * Layers are pure: they may read `ctx.meta` from prior layers but must not
 * mutate `ctx` directly — mutations to `meta` are applied by the compiler after
 * each layer returns.
 */
export interface CompilerLayer {
  /** Human-readable name used in debug output. */
  readonly name: string;
  /**
   * Render this layer's section.  May be async (e.g. if it needs to read from
   * disk or the DB).
   */
  render(ctx: CompilerContext): Promise<CompilerLayerResult> | CompilerLayerResult;
}

// ---- Re-export types used in context -----------------------------------------

export type { HistoryEntry, PersonaHistoryStats } from './history-shadow.js';

/** Full skill record (body content included for Layer 5). */
export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
  body: string;
}

/** Kept for backwards-compat with consumers that only have summary data. */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface DirectiveSummary {
  id: number;
  content: string;
  /** null means global directive */
  projectId: string | null;
  priority: number;
}

// ---- Byte ceilings -----------------------------------------------------------

const BYTE_CEILINGS: Record<string, number> = {
  IdentityLayer:     1_500,
  ConstraintsLayer:  2_000,
  SteeringLayer:     1_000,
  DirectivesLayer:     500,
  SkillsLayer:       2_000,
  HistoryLayer:      1_500,
  CardLayer:         3_000,
  TraitsLayer:         500,
};

// ---- CharterCompiler ----------------------------------------------------------

export class CharterCompiler {
  constructor(private readonly layers: CompilerLayer[]) {}

  /**
   * Run all layers in order and join their sections into the final prompt string.
   * Each layer's output is truncated to its byte ceiling before being appended.
   * Sections that are empty after trimming are skipped.
   */
  async compile(ctx: CompilerContext): Promise<string> {
    const sections: string[] = [];
    const meta: Record<string, unknown> = { ...ctx.meta };

    for (const layer of this.layers) {
      const result = await layer.render({ ...ctx, meta });
      const ceiling = BYTE_CEILINGS[layer.name];
      const raw = result.section.trim();
      if (!raw) {
        if (result.meta) Object.assign(meta, result.meta);
        continue;
      }
      const capped = ceiling != null ? truncateToBytes(raw, ceiling) : raw;
      sections.push(capped);
      if (result.meta) Object.assign(meta, result.meta);
    }

    return sections.join('\n\n---\n\n');
  }
}

// ---- Layer 1: IdentityLayer --------------------------------------------------

/**
 * Emits the charter.md content verbatim.  The charter already contains the
 * Identity / What I Own / How I Work / Boundaries sections.
 *
 * Strips the trailing `## Skills` stub if present (SkillsLayer adds it back
 * with real content).
 *
 * Ceiling: 1 500 B
 */
export class IdentityLayer implements CompilerLayer {
  readonly name = 'IdentityLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const charter = ctx.charterMd
      .replace(/^## Skills\n- \(populated dynamically.*?\n?/m, '')
      .trimEnd();

    return { section: charter };
  }
}

// ---- Layer 2: ConstraintsLayer -----------------------------------------------

/**
 * Injects the project constraints section (everything in constraints.md up to
 * the `## Steering Rules` heading, or the full file if that heading is absent).
 *
 * Emits empty string if constraintsMd is empty.
 *
 * Ceiling: 2 000 B
 */
export class ConstraintsLayer implements CompilerLayer {
  readonly name = 'ConstraintsLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { constraintsMd } = ctx;
    if (!constraintsMd.trim()) return { section: '' };

    // Strip the Steering Rules section — SteeringLayer handles that separately
    const steeringIdx = constraintsMd.indexOf('## Steering Rules');
    const body = steeringIdx > 0 ? constraintsMd.slice(0, steeringIdx).trimEnd() : constraintsMd.trimEnd();

    if (!body.trim()) return { section: '' };
    return { section: `## Project Constraints\n\n${body}` };
  }
}

// ---- Layer 3: SteeringLayer --------------------------------------------------

/**
 * Injects the active steering rules from constraints.md (the `## Steering Rules`
 * section, excluding `[SUPPRESSED]` rules).
 *
 * Only the last 5 non-suppressed rules are included (most recent wins).
 *
 * Ceiling: 1 000 B
 */
export class SteeringLayer implements CompilerLayer {
  readonly name = 'SteeringLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { constraintsMd } = ctx;
    if (!constraintsMd.trim()) return { section: '' };

    const steeringIdx = constraintsMd.indexOf('## Steering Rules');
    if (steeringIdx < 0) return { section: '' };

    const steeringSection = constraintsMd.slice(steeringIdx);
    // Extract lines that are actual rules (bullet lines not marked SUPPRESSED)
    const ruleLines = steeringSection
      .split('\n')
      .filter((l) => l.trim().startsWith('-') && !l.includes('[SUPPRESSED]'))
      .slice(-5); // last 5

    if (ruleLines.length === 0) return { section: '' };

    return {
      section: `## Steering Rules\n${ruleLines.join('\n')}`,
      meta: { steeringLayer: { ruleCount: ruleLines.length } },
    };
  }
}

// ---- Layer 4: DirectivesLayer ------------------------------------------------

/**
 * Injects active directives for the current project.
 * Global directives (projectId = null) are listed first, then project-scoped ones.
 * Directives are sorted by priority descending within each group.
 *
 * Ceiling: 500 B
 */
export class DirectivesLayer implements CompilerLayer {
  readonly name = 'DirectivesLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { directives } = ctx;
    if (directives.length === 0) return { section: '' };

    const sorted = [...directives].sort((a, b) => {
      // Global first
      const aGlobal = a.projectId == null ? 0 : 1;
      const bGlobal = b.projectId == null ? 0 : 1;
      if (aGlobal !== bGlobal) return aGlobal - bGlobal;
      // Higher priority first
      return b.priority - a.priority;
    });

    const lines = sorted.map((d) => `- ${d.content}`);

    return {
      section: `## Standing Directives\n${lines.join('\n')}`,
      meta: { directivesLayer: { directiveCount: directives.length } },
    };
  }
}

// ---- Layer 5: SkillsLayer ----------------------------------------------------

/**
 * Injects the persona's active skills with full body content.
 * Skills are sorted by confidence (high → medium → low) and, when
 * `ctx.cardStackTags` is set, domain-matching skills float to the top.
 *
 * The combined skill bodies are truncated to the 2 000 B ceiling as a group.
 *
 * Emits an empty string if there are no skills.
 *
 * Ceiling: 2 000 B
 */
export class SkillsLayer implements CompilerLayer {
  readonly name = 'SkillsLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { skills, cardStackTags } = ctx;

    if (skills.length === 0) return { section: '' };

    const domainHints = new Set((cardStackTags ?? []).map((t) => t.toLowerCase()));
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    const sorted = [...skills].sort((a, b) => {
      const aMatch = domainHints.has(a.domain.toLowerCase()) ? 0 : 1;
      const bMatch = domainHints.has(b.domain.toLowerCase()) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return (confidenceOrder[a.confidence] ?? 1) - (confidenceOrder[b.confidence] ?? 1);
    });

    const blocks = sorted.map(
      (s) =>
        `### ${s.name} *(${s.domain}, ${s.confidence})*\n${s.description}\n\n${s.body.trim()}`,
    );

    return {
      section: `## Skills\n\n${blocks.join('\n\n---\n\n')}`,
      meta: { skillsLayer: { skillCount: skills.length } },
    };
  }
}

// ---- Layer 6: HistoryLayer ---------------------------------------------------

/**
 * Injects the accumulated knowledge section derived from the DB history shadow.
 * If the persona has no history entries, emits an empty string (nothing added).
 *
 * When `ctx.cardStackTags` is provided, history entries are sorted so that
 * stack-matching entries appear first.
 *
 * Ceiling: 1 500 B
 */
export class HistoryLayer implements CompilerLayer {
  readonly name = 'HistoryLayer';

  /** Maximum number of history entries to include (avoids bloating context). */
  private readonly maxEntries: number;

  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  render(ctx: CompilerContext): CompilerLayerResult {
    const { historyEntries, stats, cardStackTags } = ctx;

    if (historyEntries.length === 0) {
      return { section: '' };
    }

    // Sort: stack-matching entries first, then by confidence desc
    const stackMatches = new Set(cardStackTags ?? []);
    const sorted = [...historyEntries].sort((a, b) => {
      const aMatch = a.stackTags.some((t) => stackMatches.has(t)) ? 1 : 0;
      const bMatch = b.stackTags.some((t) => stackMatches.has(t)) ? 1 : 0;
      if (bMatch !== aMatch) return bMatch - aMatch;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });

    const capped = sorted.slice(0, this.maxEntries);

    const byType = (type: string) => capped.filter((e) => e.entryType === type);

    const formatEntry = (e: HistoryEntry): string => {
      const date = e.createdAt.slice(0, 10);
      const project = e.projectName ?? e.projectId ?? 'unknown';
      const tags = e.stackTags.map((t) => `[${t}]`).join(' ');
      const tagPart = tags ? ` ${tags}` : '';
      return `- **${date} — ${project}${tagPart}:** ${e.content}`;
    };

    const section = (title: string, items: HistoryEntry[]) =>
      items.length > 0 ? `### ${title}\n${items.map(formatEntry).join('\n')}` : '';

    const qualityStr = stats.qualityAvg != null ? stats.qualityAvg.toFixed(1) : '—';
    const header =
      `## Accumulated Knowledge\n` +
      `> Projects: ${stats.projectsCount} | Cards: ${stats.cardsCount} | Quality avg: ${qualityStr}`;

    const coreCtx = byType('core_context');
    const coreSection =
      coreCtx.length > 0
        ? `### Core Context\n${coreCtx.map((e) => e.content).join('\n')}`
        : '';

    const parts = [
      header,
      coreSection,
      section('Learnings', byType('learning')),
      section('Decisions', byType('decision')),
      section('Patterns', byType('pattern')),
    ].filter(Boolean);

    return {
      section: parts.join('\n\n'),
      meta: { historyLayer: { entryCount: capped.length } },
    };
  }
}

// ---- Layer 7: CardLayer ------------------------------------------------------

/**
 * Injects the current card context (spec, acceptance criteria, technical notes).
 * Emits empty string if cardContext is empty.
 *
 * Ceiling: 3 000 B
 */
export class CardLayer implements CompilerLayer {
  readonly name = 'CardLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { cardContext } = ctx;
    if (!cardContext.trim()) return { section: '' };
    return { section: `## Current Card\n\n${cardContext.trim()}` };
  }
}

// ---- Layer 8: TraitsLayer ----------------------------------------------------

/**
 * Injects persona traits as a bulleted list.
 * Emits empty string if traits array is empty.
 *
 * Ceiling: 500 B
 */
export class TraitsLayer implements CompilerLayer {
  readonly name = 'TraitsLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { traits } = ctx;
    if (traits.length === 0) return { section: '' };
    const lines = traits.map((t) => `- ${t}`);
    return {
      section: `## Traits\n${lines.join('\n')}`,
      meta: { traitsLayer: { traitCount: traits.length } },
    };
  }
}

// ---- Import re-exports for layer types ---------------------------------------

import type { HistoryEntry } from './history-shadow.js';
