/**
 * routing-engine.ts — Integrated routing engine for Volundr v5
 *
 * Combines the route compiler (keyword/example/module matching) with the
 * hierarchy assessor so a single call produces both a persona assignment
 * and the correct agent hierarchy configuration for a work item.
 *
 * This is the primary entry point Volundr uses during Phase 4 to decide:
 *   - Which persona handles a card
 *   - What response tier applies
 *   - What hierarchy level to use
 *   - Which specialist teammates to spawn
 */

import {
  compileRoutes,
  matchRoutes,
  type CompiledRouteTable,
  type RoutingRuleInput,
  type RouteMatchResult,
} from './route-compiler.js';
import {
  selectTier,
  tierInstructions,
  type TierSelectionInput,
  type TierDefinition,
  type ResponseTier,
} from './response-tiers.js';
import {
  assessHierarchy,
  reassessHierarchy,
  type ProjectSnapshot,
  type HierarchyAssessment,
} from '../hierarchy-assessor.js';
import { DEFAULT_HIERARCHY_CONFIG, type HierarchyConfig, type HierarchyLevel } from '../hierarchy-config.js';

// --- Input / Output types ---

export interface CardRoutingInput {
  /** Free-text work description (card title + criteria). */
  description: string;
  /** Optional file path to match against module patterns. */
  modulePath?: string;
  /** Card size from the backlog. */
  cardSize: 'XS' | 'S' | 'M' | 'L' | 'XL';
  /** Number of domains this card touches (for tier selection). */
  domainCount?: number;
  /** Estimated number of files to create/modify. */
  estimatedFileCount?: number;
  /** True when this card closes a sprint or phase. */
  isCeremonyEvent?: boolean;
  /** True when this is a guardian audit or retrospective. */
  isAuditOrRetro?: boolean;
  /** Force structured output regardless of other signals. */
  forceStructured?: boolean;
  /** Use conjunctive (AND) matching instead of disjunctive (OR). */
  conjunctive?: boolean;
}

export interface CardRoutingResult {
  /** Best-matched persona ID, or null if no rule matched. */
  personaId: string | null;
  /** Full route match details from the compiler. */
  routeMatch: RouteMatchResult;
  /** Selected response tier. */
  tier: TierDefinition;
  /** Tier instructions string for prompt injection. */
  tierInstructions: string;
}

export interface ProjectRoutingResult {
  /** Per-card routing results. */
  cards: Array<{ cardId: string; routing: CardRoutingResult }>;
  /** Hierarchy assessment for the full project snapshot. */
  hierarchy: HierarchyAssessment;
  /** Config used for assessment. */
  config: HierarchyConfig;
}

// --- Engine class ---

/**
 * RoutingEngine — stateful wrapper that holds a compiled route table
 * and exposes routing operations.
 *
 * Volundr reads this class definition and follows the logic to:
 *   1. Compile routing rules from DB into a fast lookup table
 *   2. Route individual cards to personas + tiers
 *   3. Assess / reassess hierarchy for a full project snapshot
 */
export class RoutingEngine {
  private table: CompiledRouteTable;
  private config: HierarchyConfig;

  constructor(rules: RoutingRuleInput[], config?: Partial<HierarchyConfig>) {
    this.table = compileRoutes(rules);
    this.config = { ...DEFAULT_HIERARCHY_CONFIG, ...config };
  }

  /**
   * Route a single card to a persona and select its response tier.
   */
  routeCard(input: CardRoutingInput): CardRoutingResult {
    const routeMatch = matchRoutes(this.table, {
      description: input.description,
      modulePath: input.modulePath,
      conjunctive: input.conjunctive ?? false,
    });

    const tierInput: TierSelectionInput = {
      cardSize: input.cardSize,
      domainCount: input.domainCount ?? 1,
      estimatedFileCount: input.estimatedFileCount ?? 1,
      isCeremonyEvent: input.isCeremonyEvent ?? false,
      isAuditOrRetro: input.isAuditOrRetro ?? false,
      forceStructured: input.forceStructured,
    };

    const tier = selectTier(tierInput);

    return {
      personaId: routeMatch.best?.rule.personaId ?? null,
      routeMatch,
      tier,
      tierInstructions: tierInstructions(tier.tier),
    };
  }

  /**
   * Route multiple cards and assess the full project hierarchy in one pass.
   *
   * @param cards    Array of { cardId, input } pairs
   * @param snapshot Current project snapshot for hierarchy assessment
   */
  routeProject(
    cards: Array<{ cardId: string; input: CardRoutingInput }>,
    snapshot: ProjectSnapshot,
  ): ProjectRoutingResult {
    const cardResults = cards.map(({ cardId, input }) => ({
      cardId,
      routing: this.routeCard(input),
    }));

    const hierarchy = assessHierarchy(snapshot, this.config);

    return {
      cards: cardResults,
      hierarchy,
      config: this.config,
    };
  }

  /**
   * Reassess hierarchy mid-flight (after each execution round).
   */
  reassess(
    snapshot: ProjectSnapshot,
    currentLevel: HierarchyLevel,
  ): ReturnType<typeof reassessHierarchy> {
    return reassessHierarchy(snapshot, this.config, currentLevel);
  }

  /**
   * Replace the compiled rule table (e.g. after rules are updated in DB).
   */
  recompile(rules: RoutingRuleInput[]): void {
    this.table = compileRoutes(rules);
  }

  /**
   * Update the hierarchy config (e.g. when project constraints change).
   */
  updateConfig(patch: Partial<HierarchyConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /** Expose the compiled table for debugging / testing. */
  getTable(): CompiledRouteTable {
    return this.table;
  }
}

// --- Factory ---

/**
 * Create a RoutingEngine from an array of raw DB rows.
 * Volundr calls this after fetching routing_rules from the DB.
 */
export function createRoutingEngine(
  rules: RoutingRuleInput[],
  config?: Partial<HierarchyConfig>,
): RoutingEngine {
  return new RoutingEngine(rules, config);
}

// --- Hierarchy-aware tier override ---

/**
 * Elevate tier based on hierarchy level:
 * - flat mode with XS/S cards can stay at minimal/standard
 * - two-level with cross-domain always gets at least detailed
 *
 * Applied AFTER initial tier selection as a post-processing step.
 */
export function applyHierarchyTierOverride(
  tier: ResponseTier,
  hierarchy: HierarchyAssessment,
): ResponseTier {
  // Ceremony is never downgraded
  if (tier === 'ceremony') return tier;

  // In two-level hierarchy with a Reviewer, cross-domain work gets detailed minimum
  if (hierarchy.level === 'two' && hierarchy.spawnReviewer) {
    if (tier === 'minimal' || tier === 'standard') return 'detailed';
  }

  return tier;
}
