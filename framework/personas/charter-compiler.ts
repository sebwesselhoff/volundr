/**
 * Charter Compiler
 *
 * Builds the Layer 2 system prompt section for an activated persona by running
 * a pipeline of CompilerLayers in order.  Each layer receives a shared context
 * and emits a markdown string that is appended to the final output.
 *
 * Layer numbering (matches charter-format.md sections):
 *   1 — IdentityLayer   (charter.md static content)
 *   2 — HistoryLayer    (accumulated knowledge from DB shadow)
 *   3 — SkillsLayer     (skills injected at activation time)
 *   4-8 — reserved for future cards (routing, constraints, project ctx, etc.)
 *
 * Usage:
 *   const compiler = new CharterCompiler([
 *     new IdentityLayer(),
 *     new HistoryLayer(),
 *     new SkillsLayer(),
 *   ]);
 *   const prompt = await compiler.compile(ctx);
 */

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
  /** Skills to inject — list of skill summaries  */
  skills: SkillSummary[];
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

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
}

// ---- CharterCompiler ----------------------------------------------------------

export class CharterCompiler {
  constructor(private readonly layers: CompilerLayer[]) {}

  /**
   * Run all layers in order and join their sections into the final prompt string.
   * Sections that return an empty string are skipped (no blank separator added).
   */
  async compile(ctx: CompilerContext): Promise<string> {
    const sections: string[] = [];
    const meta: Record<string, unknown> = { ...ctx.meta };

    for (const layer of this.layers) {
      const result = await layer.render({ ...ctx, meta });
      if (result.section.trim()) {
        sections.push(result.section.trim());
      }
      if (result.meta) {
        Object.assign(meta, result.meta);
      }
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
 */
export class IdentityLayer implements CompilerLayer {
  readonly name = 'IdentityLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const charter = ctx.charterMd
      // Remove the placeholder "## Skills" section added in empty templates
      .replace(/^## Skills\n- \(populated dynamically.*?\n?/m, '')
      .trimEnd();

    return { section: charter };
  }
}

// ---- Layer 2: HistoryLayer ---------------------------------------------------

/**
 * Injects the accumulated knowledge section derived from the DB history shadow.
 * If the persona has no history entries, emits an empty string (nothing added).
 *
 * When `ctx.cardStackTags` is provided, history entries are sorted so that
 * stack-matching entries appear first (still filtered by relevance, not removed).
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

// ---- Layer 3: SkillsLayer ---------------------------------------------------

/**
 * Injects the persona's active skills as a bulleted list.
 * Skills are sorted by confidence (high → medium → low) and, when
 * `ctx.cardStackTags` is set, domain-matching skills float to the top.
 *
 * Emits an empty string if there are no skills.
 */
export class SkillsLayer implements CompilerLayer {
  readonly name = 'SkillsLayer';

  render(ctx: CompilerContext): CompilerLayerResult {
    const { skills, cardStackTags } = ctx;

    if (skills.length === 0) {
      return { section: '' };
    }

    const domainHints = new Set((cardStackTags ?? []).map((t) => t.toLowerCase()));
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    const sorted = [...skills].sort((a, b) => {
      const aMatch = domainHints.has(a.domain.toLowerCase()) ? 0 : 1;
      const bMatch = domainHints.has(b.domain.toLowerCase()) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return (confidenceOrder[a.confidence] ?? 1) - (confidenceOrder[b.confidence] ?? 1);
    });

    const lines = sorted.map(
      (s) => `- **${s.name}** *(${s.domain}, ${s.confidence})*: ${s.description}`,
    );

    return {
      section: `## Skills\n${lines.join('\n')}`,
      meta: { skillsLayer: { skillCount: skills.length } },
    };
  }
}
