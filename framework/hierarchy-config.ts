/**
 * Volundr v5.1 - Dynamic Hierarchy Configuration
 *
 * Defines thresholds for auto-selecting hierarchy level (flat/two)
 * and limits for mid-flight scaling. NOT executable code - it's a typed
 * reference document read by Volundr during Phase 4.
 *
 * Set per-project in blueprint phase. Stored in projects/{id}/constraints.md
 * under a "## Hierarchy Config" section, or defaults are used.
 */

export type HierarchyLevel = 'flat' | 'two';

export interface HierarchyConfig {
  // --- Level selection thresholds ---
  flatMaxCards: number;                  // Max cards for flat mode (Volundr + subagents only)

  // --- Promotion thresholds (mid-flight) ---
  permanentReviewerThreshold: number;    // Cross-domain deps before spawning permanent Reviewer teammate
  dropToFlatThreshold: number;           // Remaining cards before dropping to flat mode (spec default: 2)

  // --- Limits ---
  maxTeammates: number;                  // Total teammates including Volundr (team lead)
  maxConcurrentAgents: number;           // Max total agents across all levels
  maxDevelopers: number;           // Max Developer teammates per domain

  // --- Cost controls ---
  budgetCeiling: number | null;          // Dollar amount - pause all work if exceeded
  costWarningThreshold: number;          // Fraction of budgetCeiling - warn developer

  // --- Override ---
  forceLevel?: HierarchyLevel;           // Manual override - skip auto-assessment
}

export const DEFAULT_HIERARCHY_CONFIG: HierarchyConfig = {
  flatMaxCards: 5,
  permanentReviewerThreshold: 5,
  dropToFlatThreshold: 2,
  maxTeammates: 12,
  maxConcurrentAgents: 12,
  maxDevelopers: 4,
  budgetCeiling: null,
  costWarningThreshold: 0.8,
};

export const MODEL_TIERS = {
  // Tier names
  grunt: 'haiku',      // fixers, small patches, format fixes
  standard: 'sonnet',  // most implementation work
  deep: 'opus',        // architecture, security-sensitive, complex refactors

  // Model IDs for Agent tool
  modelIds: {
    haiku: 'haiku',
    sonnet: 'sonnet',
    opus: 'opus',
  } as const,

  // Default model per role
  roles: {
    'developer': 'sonnet',
    'architect': 'sonnet',
    'qa-engineer': 'sonnet',
    'devops-engineer': 'sonnet',
    'designer': 'sonnet',
    'reviewer': 'sonnet',
    'guardian': 'sonnet',
    'researcher': 'sonnet',
    'fixer': 'haiku',
    'tester': 'sonnet',
    'content': 'haiku',
    'planner': 'sonnet',
  } as Record<string, string>,

  // Escalation rules
  escalation: {
    retryOnSameModel: 1,       // retry once on same model
    escalateAfter: 2,          // after 2 failures, bump model tier
    maxModel: 'opus',          // never escalate beyond this
    tierOrder: ['haiku', 'sonnet', 'opus'] as const,
  },
} as const;
