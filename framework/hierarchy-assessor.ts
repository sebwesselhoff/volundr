/**
 * Vǫlundr v5.1 - Dynamic Hierarchy Assessor
 *
 * Decision logic for selecting and adjusting the agent hierarchy level.
 * NOT executable code - Vǫlundr reads this and follows the logic.
 *
 * Called at:
 * 1. Start of Phase 4 (initial assessment)
 * 2. After each round of execution (re-assessment for scaling)
 * 3. After scope changes (cards added/removed mid-flight)
 */

import type { HierarchyConfig, HierarchyLevel } from './hierarchy-config.js';
import { AGENT_REGISTRY_LIST } from './agents/registry.js';

// --- Input types ---

export interface CardSnapshot {
  title?: string;
  criteria?: string;
  technicalNotes?: string;
}

export interface ProjectSnapshot {
  totalCards: number;                    // Total cards in backlog + in_progress + done
  remainingCards: number;                // Cards not yet done
  domainCount: number;                   // Number of distinct epics/domains
  crossDomainDeps: number;              // Count of deps that cross domain boundaries
  largestDomainCards: number;            // Card count in the biggest domain
  currentCost: number;                   // Total spend so far ($)
  activeTeammates: number;               // Currently running teammates
  activeSubagents: number;               // Currently running subagents
  cardCriteria?: string[];               // Flattened list of card criteria text (legacy, for backward compat)
  cards?: CardSnapshot[];               // Richer card objects with title, criteria, technicalNotes
}

// --- Output types ---

export interface HierarchyAssessment {
  level: HierarchyLevel;
  reason: string;                        // Human-readable explanation
  spawnReviewer: boolean;                // Whether to spawn permanent Reviewer teammate
  recommendedDevelopers: number;         // 1-4 Developer teammates to spawn
  conditionalTeammates: string[];        // e.g. ['qa-engineer', 'designer'] - spawn if relevant
  budgetWarning: boolean;                // True if approaching budget ceiling
  budgetPause: boolean;                  // True if budget exceeded - pause all work
}

// --- Assessment logic ---

/**
 * Initial assessment - called at start of Phase 4.
 *
 * Volundr reads this function's logic and applies it:
 *
 * 1. Check budget → pause if exceeded (takes precedence over everything, even forceLevel)
 * 2. Check forceLevel override → use it if set
 * 3. Count cards → select level (≤5 flat, 6+ two)
 * 4. Compute recommendedDevelopers from domain count
 * 5. Build conditionalTeammates from card content signals
 * 6. Check cross-domain deps → decide on Reviewer
 * 7. Return assessment
 *
 * Note: Architect is always included for two-level hierarchy and is NOT listed in
 * conditionalTeammates - it is mandatory.
 */
export function assessHierarchy(
  snapshot: ProjectSnapshot,
  config: HierarchyConfig,
): HierarchyAssessment {
  // Budget check takes precedence over everything - even forceLevel overrides.
  const budgetPause = config.budgetCeiling !== null && snapshot.currentCost >= config.budgetCeiling;
  const budgetWarning = config.budgetCeiling !== null &&
    snapshot.currentCost >= config.budgetCeiling * config.costWarningThreshold;

  if (budgetPause) {
    return {
      level: 'flat',
      reason: `Budget ceiling ($${config.budgetCeiling}) exceeded. Current: $${snapshot.currentCost.toFixed(2)}. Pausing all work.`,
      spawnReviewer: false,
      recommendedDevelopers: 0,
      conditionalTeammates: [],
      budgetWarning: true,
      budgetPause: true,
    };
  }

  // Force override
  if (config.forceLevel) {
    const developers = config.forceLevel === 'flat'
      ? 0
      : Math.min(config.maxDevelopers, Math.ceil(snapshot.domainCount));
    return {
      level: config.forceLevel,
      reason: `Forced to ${config.forceLevel} by config override`,
      spawnReviewer: snapshot.crossDomainDeps > config.permanentReviewerThreshold,
      recommendedDevelopers: developers,
      conditionalTeammates: config.forceLevel === 'flat' ? [] : buildConditionalTeammates(snapshot, config),
      budgetWarning,
      budgetPause: false,
    };
  }

  // FLAT: small projects (≤5 cards)
  if (snapshot.totalCards <= config.flatMaxCards) {
    return {
      level: 'flat',
      reason: `${snapshot.totalCards} cards ≤ ${config.flatMaxCards} threshold. Volundr handles directly.`,
      spawnReviewer: false,
      recommendedDevelopers: 0,
      conditionalTeammates: [],
      budgetWarning,
      budgetPause: false,
    };
  }

  // TWO-LEVEL: 6+ cards
  // Architect is always mandatory for two-level - not listed in conditionalTeammates.
  const recommendedDevelopers = Math.min(config.maxDevelopers, Math.ceil(snapshot.domainCount));
  const spawnReviewer = snapshot.crossDomainDeps > config.permanentReviewerThreshold;
  const conditionalTeammates = buildConditionalTeammates(snapshot, config);

  return {
    level: 'two',
    reason: `${snapshot.totalCards} cards across ${snapshot.domainCount} domains. Two-level hierarchy with Architect + ${recommendedDevelopers} Developer(s).`,
    spawnReviewer,
    recommendedDevelopers,
    conditionalTeammates,
    budgetWarning,
    budgetPause: false,
  };
}

/**
 * Build the list of conditional teammates based on card content signals.
 * Architect is always mandatory for two-level and is NOT included here.
 *
 * Spawn rules are driven by the AGENT_REGISTRY: any entry with a non-null
 * `conditionalSpawn` is evaluated. For each such agent type, the card set
 * (snapshot.cards when available, otherwise snapshot.cardCriteria for backward
 * compat) is scanned for cardSignals regex matches. If at least `minCards`
 * cards match, the agent type is added to the result list.
 */
function buildConditionalTeammates(
  snapshot: ProjectSnapshot,
  config: HierarchyConfig,
): string[] {
  // Read conditional spawn rules from registry
  const conditionalTypes = AGENT_REGISTRY_LIST.filter(r => r.conditionalSpawn);
  const teammates: string[] = [];

  for (const agentType of conditionalTypes) {
    const { cardSignals, minCards } = agentType.conditionalSpawn!;

    let matchCount = 0;

    if (snapshot.cards && snapshot.cards.length > 0) {
      // Preferred path: use richer card objects
      matchCount = snapshot.cards.filter(card => {
        const text = `${card.criteria ?? ''} ${card.technicalNotes ?? ''} ${card.title ?? ''}`;
        return cardSignals.some(signal => signal.test(text));
      }).length;
    } else {
      // Backward-compat path: use flat cardCriteria strings
      const criteria = snapshot.cardCriteria ?? [];
      matchCount = criteria.filter(text =>
        cardSignals.some(signal => signal.test(text)),
      ).length;
    }

    if (matchCount >= minCards) {
      teammates.push(agentType.type);
    }
  }

  return teammates;
}

/**
 * Re-assessment - called after each execution round.
 *
 * Checks for mid-flight scaling triggers:
 *
 * 1. Budget ceiling → pause
 * 2. Only N cards remain → drop to flat
 * 3. Cross-domain deps increased → spawn Reviewer
 * 4. Cost warning → notify developer
 *
 * Note: Two spec-defined flows are handled outside this function:
 * - "Domain completes → shut down Developer" - teammates naturally go idle
 *   when their domain's tasks are all complete. No assessor logic needed.
 * - "Critical issues found → Guardian spawns Fixer teammates" - Guardian
 *   messages Volundr with critical issues, Volundr creates fix cards and
 *   spawns fixer subagents. This is part of the Guardian review flow.
 */
export function reassessHierarchy(
  snapshot: ProjectSnapshot,
  config: HierarchyConfig,
  currentLevel: HierarchyLevel,
): { newLevel: HierarchyLevel; actions: ScalingAction[] } {
  const actions: ScalingAction[] = [];

  // Budget ceiling
  if (config.budgetCeiling !== null && snapshot.currentCost >= config.budgetCeiling) {
    actions.push({ type: 'pause_all', reason: 'Budget ceiling exceeded' });
    return { newLevel: 'flat', actions };
  }

  // Drop to flat if few cards remain
  if (snapshot.remainingCards <= config.dropToFlatThreshold && currentLevel !== 'flat') {
    actions.push({
      type: 'scale_down',
      reason: `Only ${snapshot.remainingCards} cards remain. Dropping to flat.`,
    });
    return { newLevel: 'flat', actions };
  }

  // Spawn reviewer if cross-domain deps grew
  if (snapshot.crossDomainDeps > config.permanentReviewerThreshold) {
    actions.push({ type: 'spawn_reviewer', reason: `${snapshot.crossDomainDeps} cross-domain deps exceed threshold` });
  }

  // Cost warning
  if (config.budgetCeiling !== null && snapshot.currentCost >= config.budgetCeiling * config.costWarningThreshold) {
    actions.push({ type: 'cost_warning', reason: `Approaching budget ceiling: $${snapshot.currentCost.toFixed(2)} / $${config.budgetCeiling}` });
  }

  return { newLevel: currentLevel, actions };
}

// --- Scaling action types ---

export type ScalingAction =
  | { type: 'pause_all'; reason: string }
  | { type: 'scale_down'; reason: string }
  | { type: 'spawn_reviewer'; reason: string }
  | { type: 'cost_warning'; reason: string };
