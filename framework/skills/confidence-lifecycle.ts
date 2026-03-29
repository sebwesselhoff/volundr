/**
 * confidence-lifecycle.ts — skill confidence lifecycle management
 *
 * Handles three lifecycle concerns:
 *  1. Auto-promotion   — usage evidence pushes confidence up
 *  2. Staleness        — time-based decay when reviewByDate is exceeded
 *  3. Build failure    — failed builds that cite a skill lower its confidence
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

// --- Transition tables ---

/** Promote confidence one level. High stays high. */
const PROMOTE: Record<ConfidenceLevel, ConfidenceLevel> = {
  low: 'medium',
  medium: 'high',
  high: 'high',
};

/** Demote confidence one level. Low stays low. */
const DEMOTE: Record<ConfidenceLevel, ConfidenceLevel> = {
  low: 'low',
  medium: 'low',
  high: 'medium',
};

// --- Auto-promotion ---

export interface PromotionInput {
  currentConfidence: ConfidenceLevel;
  /** Number of times this skill has been used across projects. */
  usageCount: number;
  /** ISO date of the last successful card that used this skill. */
  lastSuccessDate: string | null;
  /** ISO date the skill was last validated. */
  validatedAt: string;
}

export interface PromotionResult {
  newConfidence: ConfidenceLevel;
  promoted: boolean;
  reason: string;
}

/**
 * Auto-promote a skill's confidence based on usage evidence.
 *
 * Rules (applied in order, first match wins):
 *  - Already `high`                         → no change
 *  - usageCount >= 10 AND has recent success → promote
 *  - usageCount >= 3  AND has recent success → promote (low→medium only)
 *
 * "Recent" means within the last 90 days.
 */
export function evaluatePromotion(input: PromotionInput): PromotionResult {
  const { currentConfidence, usageCount, lastSuccessDate } = input;

  if (currentConfidence === 'high') {
    return { newConfidence: 'high', promoted: false, reason: 'already at highest confidence' };
  }

  const hasRecentSuccess = lastSuccessDate !== null && daysSince(lastSuccessDate) <= 90;

  if (usageCount >= 10 && hasRecentSuccess) {
    return {
      newConfidence: PROMOTE[currentConfidence],
      promoted: PROMOTE[currentConfidence] !== currentConfidence,
      reason: `promoted after ${usageCount} uses with recent success`,
    };
  }

  if (usageCount >= 3 && hasRecentSuccess && currentConfidence === 'low') {
    return {
      newConfidence: 'medium',
      promoted: true,
      reason: `promoted low→medium after ${usageCount} uses with recent success`,
    };
  }

  return {
    newConfidence: currentConfidence,
    promoted: false,
    reason: 'insufficient usage evidence for promotion',
  };
}

// --- Staleness ---

export interface StalenessInput {
  currentConfidence: ConfidenceLevel;
  /** ISO date string (YYYY-MM-DD) when the skill should next be reviewed. */
  reviewByDate: string;
  /** Today's date in ISO format. Defaults to actual today if omitted. */
  today?: string;
}

export interface StalenessResult {
  isStale: boolean;
  /** Days past the reviewByDate (0 if not yet stale). */
  daysOverdue: number;
  newConfidence: ConfidenceLevel;
  reason: string;
}

/**
 * Mark a skill stale and demote its confidence if the reviewByDate has passed.
 *
 * Thresholds:
 *  - 0–30 days overdue   → stale flag only, no confidence change
 *  - 31–90 days overdue  → demote one level (high→medium, medium→low)
 *  - 91+ days overdue    → demote to low regardless of current level
 */
export function evaluateStaleness(input: StalenessInput): StalenessResult {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const daysOverdue = Math.max(0, daysBetween(input.reviewByDate, today));

  if (daysOverdue === 0) {
    return {
      isStale: false,
      daysOverdue: 0,
      newConfidence: input.currentConfidence,
      reason: 'not yet past review date',
    };
  }

  if (daysOverdue <= 30) {
    return {
      isStale: true,
      daysOverdue,
      newConfidence: input.currentConfidence,
      reason: `stale (${daysOverdue}d overdue) — within grace period, confidence unchanged`,
    };
  }

  if (daysOverdue <= 90) {
    const newConfidence = DEMOTE[input.currentConfidence];
    return {
      isStale: true,
      daysOverdue,
      newConfidence,
      reason: `stale (${daysOverdue}d overdue) — demoted one level`,
    };
  }

  // 91+ days: drop to low unconditionally
  return {
    isStale: true,
    daysOverdue,
    newConfidence: 'low',
    reason: `severely stale (${daysOverdue}d overdue) — demoted to low`,
  };
}

// --- Build failure correlation ---

export interface BuildFailureInput {
  currentConfidence: ConfidenceLevel;
  /** Number of consecutive build failures attributed to cards that used this skill. */
  consecutiveFailures: number;
  /** Total builds that cited this skill (used for failure rate). */
  totalBuilds: number;
  /** Number of failed builds out of totalBuilds. */
  failedBuilds: number;
}

export interface BuildFailureResult {
  newConfidence: ConfidenceLevel;
  demoted: boolean;
  reason: string;
}

/**
 * Demote a skill's confidence based on build failure correlation.
 *
 * Rules:
 *  - 3+ consecutive failures                  → demote one level
 *  - failure rate >= 50% across 5+ builds      → demote one level
 *  - Both conditions met simultaneously        → demote two levels (floor at low)
 */
export function evaluateBuildFailureCorrelation(input: BuildFailureInput): BuildFailureResult {
  const { currentConfidence, consecutiveFailures, totalBuilds, failedBuilds } = input;

  const failureRate = totalBuilds >= 5 ? failedBuilds / totalBuilds : 0;
  const highRate = failureRate >= 0.5;
  const consecutiveProblem = consecutiveFailures >= 3;

  if (!consecutiveProblem && !highRate) {
    return { newConfidence: currentConfidence, demoted: false, reason: 'no failure threshold met' };
  }

  let newConfidence: ConfidenceLevel = currentConfidence;

  if (consecutiveProblem && highRate) {
    // Demote two levels
    newConfidence = DEMOTE[DEMOTE[currentConfidence]];
  } else {
    // Demote one level
    newConfidence = DEMOTE[currentConfidence];
  }

  const demoted = newConfidence !== currentConfidence;
  const reasons: string[] = [];
  if (consecutiveProblem) reasons.push(`${consecutiveFailures} consecutive failures`);
  if (highRate) reasons.push(`${Math.round(failureRate * 100)}% failure rate over ${totalBuilds} builds`);

  return {
    newConfidence,
    demoted,
    reason: reasons.join(' + '),
  };
}

// --- Composite lifecycle update ---

export interface LifecycleInput {
  currentConfidence: ConfidenceLevel;
  usageCount: number;
  lastSuccessDate: string | null;
  validatedAt: string;
  reviewByDate: string;
  consecutiveFailures: number;
  totalBuilds: number;
  failedBuilds: number;
  today?: string;
}

export interface LifecycleResult {
  newConfidence: ConfidenceLevel;
  changed: boolean;
  isStale: boolean;
  daysOverdue: number;
  reasons: string[];
}

/**
 * Run all three lifecycle evaluations in priority order and return a single
 * consolidated result.
 *
 * Priority: build failures > staleness > promotion
 * (i.e. a failing build can override a promotion that would otherwise apply)
 */
export function runLifecycle(input: LifecycleInput): LifecycleResult {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const reasons: string[] = [];

  let confidence = input.currentConfidence;

  // 1. Build failure correlation (highest priority)
  const failureResult = evaluateBuildFailureCorrelation({
    currentConfidence: confidence,
    consecutiveFailures: input.consecutiveFailures,
    totalBuilds: input.totalBuilds,
    failedBuilds: input.failedBuilds,
  });
  if (failureResult.demoted) {
    confidence = failureResult.newConfidence;
    reasons.push(`build-failure: ${failureResult.reason}`);
  }

  // 2. Staleness
  const stalenessResult = evaluateStaleness({
    currentConfidence: confidence,
    reviewByDate: input.reviewByDate,
    today,
  });
  if (stalenessResult.isStale && stalenessResult.newConfidence !== confidence) {
    confidence = stalenessResult.newConfidence;
    reasons.push(`staleness: ${stalenessResult.reason}`);
  }

  // 3. Auto-promotion (only if not already demoted by failures)
  if (!failureResult.demoted) {
    const promotionResult = evaluatePromotion({
      currentConfidence: confidence,
      usageCount: input.usageCount,
      lastSuccessDate: input.lastSuccessDate,
      validatedAt: input.validatedAt,
    });
    if (promotionResult.promoted) {
      confidence = promotionResult.newConfidence;
      reasons.push(`promotion: ${promotionResult.reason}`);
    }
  }

  return {
    newConfidence: confidence,
    changed: confidence !== input.currentConfidence,
    isStale: stalenessResult.isStale,
    daysOverdue: stalenessResult.daysOverdue,
    reasons,
  };
}

// --- Utilities ---

function daysSince(isoDate: string, today?: string): number {
  const from = new Date(isoDate).getTime();
  const to = today ? new Date(today).getTime() : Date.now();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function daysBetween(earlier: string, later: string): number {
  const from = new Date(earlier).getTime();
  const to = new Date(later).getTime();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}
