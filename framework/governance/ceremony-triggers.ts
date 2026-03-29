/**
 * ceremony-triggers.ts — Automated ceremony trigger system for Volundr v5
 *
 * Defines the ceremony types, trigger conditions, and evaluation logic.
 * Volundr evaluates triggers after every significant state change and
 * acts on fired triggers before resuming normal card execution.
 *
 * Ceremony types:
 *   sprint_review       — End of a sprint batch (N cards completed)
 *   phase_transition    — Project moves to a new phase
 *   optimization_cycle  — Every 5 scored cards; refactoring/cleanup nudge
 *   guardian_audit      — Quality average drops below threshold
 *   retrospective       — Project completes (all cards done)
 *   cost_warning        — Cost approaches budget ceiling
 *
 * Evaluation order:
 *   1. retrospective (project complete — highest priority)
 *   2. guardian_audit (quality emergency)
 *   3. phase_transition
 *   4. sprint_review
 *   5. optimization_cycle
 *   6. cost_warning
 */

// --- Types ---

export type CeremonyType =
  | 'sprint_review'
  | 'phase_transition'
  | 'optimization_cycle'
  | 'guardian_audit'
  | 'retrospective'
  | 'cost_warning';

export interface CeremonyTrigger {
  type: CeremonyType;
  /** Human-readable description of why this ceremony was triggered. */
  reason: string;
  /** Severity: info = informational, warning = action needed, critical = block. */
  severity: 'info' | 'warning' | 'critical';
  /** When the ceremony must be actioned immediately (blocks card work). */
  blocksExecution: boolean;
  /** Additional context for the ceremony handler. */
  context: Record<string, unknown>;
}

// --- Snapshot input ---

export interface CeremonySnapshot {
  /** Total cards in the project. */
  totalCards: number;
  /** Cards with status = 'done'. */
  completedCards: number;
  /** Cards scored (have a quality score row). */
  scoredCards: number;
  /** Cards scored in the current sprint batch (since last sprint_review). */
  cardsSinceLastSprint: number;
  /** Number of cards scored since last optimization_cycle. */
  cardsSinceLastOptimization: number;
  /** Current project phase. */
  phase: string;
  /** Previous project phase (to detect transition). */
  previousPhase: string | null;
  /** Rolling average quality score (0-5 scale, null if no scores yet). */
  qualityAvg: number | null;
  /** Current accumulated cost ($). */
  currentCost: number;
  /** Budget ceiling (null = no ceiling). */
  budgetCeiling: number | null;
  /** Cost warning threshold fraction (e.g. 0.8). */
  costWarningThreshold: number;
}

// --- Configuration ---

export interface CeremonyConfig {
  /** Cards completed per sprint before triggering sprint_review. Default: 5. */
  sprintSize: number;
  /** Quality avg below this value triggers guardian_audit. Default: 6.0. */
  qualityAuditThreshold: number;
  /** Cards scored before triggering optimization_cycle. Default: 5. */
  optimizationCycleInterval: number;
}

export const DEFAULT_CEREMONY_CONFIG: CeremonyConfig = {
  sprintSize: 5,
  qualityAuditThreshold: 6.0,
  optimizationCycleInterval: 5,
};

// --- Evaluation ---

/**
 * Evaluate which ceremonies should fire given the current snapshot.
 *
 * Returns an ordered list of triggers (highest priority first).
 * Callers must process triggers in order, respecting blocksExecution.
 */
export function evaluateCeremonies(
  snapshot: CeremonySnapshot,
  config: CeremonyConfig = DEFAULT_CEREMONY_CONFIG,
): CeremonyTrigger[] {
  const triggers: CeremonyTrigger[] = [];

  // 1. Retrospective — all cards complete
  if (snapshot.totalCards > 0 && snapshot.completedCards >= snapshot.totalCards) {
    triggers.push({
      type: 'retrospective',
      reason: `All ${snapshot.totalCards} cards completed. Project retrospective required.`,
      severity: 'critical',
      blocksExecution: true,
      context: {
        totalCards: snapshot.totalCards,
        qualityAvg: snapshot.qualityAvg,
        currentCost: snapshot.currentCost,
      },
    });
    // Retrospective supersedes all other ceremonies
    return triggers;
  }

  // 2. Guardian audit — quality below threshold
  if (
    snapshot.qualityAvg !== null &&
    snapshot.scoredCards >= 3 &&
    snapshot.qualityAvg < config.qualityAuditThreshold
  ) {
    triggers.push({
      type: 'guardian_audit',
      reason: `Quality average ${snapshot.qualityAvg.toFixed(2)} is below threshold ${config.qualityAuditThreshold}. Guardian audit required.`,
      severity: 'critical',
      blocksExecution: true,
      context: {
        qualityAvg: snapshot.qualityAvg,
        threshold: config.qualityAuditThreshold,
        scoredCards: snapshot.scoredCards,
      },
    });
  }

  // 3. Phase transition
  if (
    snapshot.previousPhase !== null &&
    snapshot.previousPhase !== snapshot.phase
  ) {
    triggers.push({
      type: 'phase_transition',
      reason: `Project transitioned from phase '${snapshot.previousPhase}' to '${snapshot.phase}'.`,
      severity: 'info',
      blocksExecution: false,
      context: {
        fromPhase: snapshot.previousPhase,
        toPhase: snapshot.phase,
      },
    });
  }

  // 4. Sprint review — N cards completed since last sprint
  if (snapshot.cardsSinceLastSprint > 0 &&
    snapshot.cardsSinceLastSprint % config.sprintSize === 0) {
    triggers.push({
      type: 'sprint_review',
      reason: `${snapshot.cardsSinceLastSprint} cards completed in this sprint batch. Sprint review due.`,
      severity: 'warning',
      blocksExecution: false,
      context: {
        cardsInSprint: snapshot.cardsSinceLastSprint,
        sprintSize: config.sprintSize,
        completedTotal: snapshot.completedCards,
      },
    });
  }

  // 5. Optimization cycle — every N scored cards
  if (
    snapshot.cardsSinceLastOptimization > 0 &&
    snapshot.cardsSinceLastOptimization % config.optimizationCycleInterval === 0
  ) {
    triggers.push({
      type: 'optimization_cycle',
      reason: `${snapshot.cardsSinceLastOptimization} cards scored since last optimization cycle. Refactoring/cleanup review due.`,
      severity: 'info',
      blocksExecution: false,
      context: {
        cardsSinceLastOptimization: snapshot.cardsSinceLastOptimization,
        interval: config.optimizationCycleInterval,
      },
    });
  }

  // 6. Cost warning
  if (
    snapshot.budgetCeiling !== null &&
    snapshot.currentCost >= snapshot.budgetCeiling * snapshot.costWarningThreshold
  ) {
    const pct = Math.round((snapshot.currentCost / snapshot.budgetCeiling) * 100);
    triggers.push({
      type: 'cost_warning',
      reason: `Cost $${snapshot.currentCost.toFixed(2)} is ${pct}% of budget ceiling $${snapshot.budgetCeiling}. Review spend.`,
      severity: snapshot.currentCost >= snapshot.budgetCeiling ? 'critical' : 'warning',
      blocksExecution: snapshot.currentCost >= snapshot.budgetCeiling,
      context: {
        currentCost: snapshot.currentCost,
        budgetCeiling: snapshot.budgetCeiling,
        pctUsed: pct,
      },
    });
  }

  return triggers;
}

// --- Ceremony action map ---

/**
 * Describes what Volundr should do when a ceremony fires.
 * Volundr reads this map and executes the listed actions.
 */
export const CEREMONY_ACTIONS: Record<CeremonyType, string[]> = {
  sprint_review: [
    'Log sprint_review event via vldr.events.log()',
    'Update session summary with sprint metrics',
    'Create checkpoint via vldr.checkpoints.save()',
    'Optionally run a lightweight retrospective sub-agent',
    'Resume card execution after checkpoint',
  ],
  phase_transition: [
    'Log phase_transition event via vldr.events.log()',
    'Update project phase in DB',
    'Run hierarchy reassessment (reassessHierarchy)',
    'Notify developer via journal entry',
    'Resume with updated hierarchy',
  ],
  optimization_cycle: [
    'Log optimization_cycle event via vldr.events.log()',
    'Emit optimization_cycle_due command to dashboard',
    'Queue cleanup/refactor suggestions for developer review',
    'Resume card execution without blocking',
  ],
  guardian_audit: [
    'Log guardian_audit event via vldr.events.log()',
    'Pause all card execution (blocksExecution = true)',
    'Spawn Guardian teammate for full quality audit',
    'Guardian produces audit report in projects/{id}/reports/',
    'Resume only after Guardian signals audit_complete',
  ],
  retrospective: [
    'Log milestone_reached event via vldr.events.log()',
    'Write retrospective to projects/{id}/retrospective.md',
    'Compute final quality trends and cost breakdown',
    'Archive project state (checkpoints, reports)',
    'Mark project status = complete',
  ],
  cost_warning: [
    'Log cost_warning event via vldr.events.log()',
    'If blocksExecution: pause all work, notify developer',
    'If warning only: add journal entry, continue with caution',
  ],
};

// --- DB command helper ---

/**
 * Build the command payload to persist a ceremony trigger to the DB
 * (inserts into the commands table for dashboard visibility).
 */
export function buildCeremonyCommand(
  trigger: CeremonyTrigger,
  projectId: string,
): {
  type: string;
  projectId: string;
  detail: string;
  status: 'pending';
} {
  return {
    type: `ceremony_${trigger.type}`,
    projectId,
    detail: JSON.stringify({
      reason: trigger.reason,
      severity: trigger.severity,
      blocksExecution: trigger.blocksExecution,
      context: trigger.context,
    }),
    status: 'pending',
  };
}
