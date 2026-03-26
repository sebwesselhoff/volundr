/**
 * response-tiers.ts — Response tier system for Volundr routing
 *
 * Defines 4 response tiers and the selection logic that maps a routed
 * work item onto the appropriate tier.  Tiers control verbosity, structure,
 * and the level of ceremony applied to a Volundr response.
 *
 * Tier hierarchy (ascending complexity):
 *   1. minimal  — inline acknowledgements, one-liners, status pings
 *   2. standard — most implementation cards; code + short summary
 *   3. detailed — multi-file changes, cross-domain work, new abstractions
 *   4. ceremony — sprints, phase transitions, guardian audits, retrospectives
 */

// --- Tier definitions ---

export type ResponseTier = 'minimal' | 'standard' | 'detailed' | 'ceremony';

export interface TierDefinition {
  tier: ResponseTier;
  label: string;
  /** Max approximate output tokens before truncation guidance applies. */
  maxTokens: number;
  /** Whether a structured heading/section layout is required. */
  requiresStructure: boolean;
  /** Whether a quality score POST is expected after completion. */
  requiresQualityScore: boolean;
  description: string;
}

export const TIER_DEFINITIONS: Record<ResponseTier, TierDefinition> = {
  minimal: {
    tier: 'minimal',
    label: 'Minimal',
    maxTokens: 512,
    requiresStructure: false,
    requiresQualityScore: false,
    description: 'Inline acknowledgements, status pings, one-line confirmations.',
  },
  standard: {
    tier: 'standard',
    label: 'Standard',
    maxTokens: 4096,
    requiresStructure: false,
    requiresQualityScore: true,
    description: 'Typical implementation cards: code changes + concise summary.',
  },
  detailed: {
    tier: 'detailed',
    label: 'Detailed',
    maxTokens: 12288,
    requiresStructure: true,
    requiresQualityScore: true,
    description: 'Multi-file or cross-domain work; structured sections required.',
  },
  ceremony: {
    tier: 'ceremony',
    label: 'Ceremony',
    maxTokens: 32768,
    requiresStructure: true,
    requiresQualityScore: false,
    description: 'Sprint boundaries, phase transitions, guardian audits, retrospectives.',
  },
};

// --- Selection input ---

export interface TierSelectionInput {
  /** Card size as defined in the backlog (XS|S|M|L|XL). */
  cardSize: 'XS' | 'S' | 'M' | 'L' | 'XL';
  /** Number of domains/epics touched by this work item. */
  domainCount: number;
  /** Number of files expected to be created or modified. */
  estimatedFileCount: number;
  /** True when this response closes a sprint, phase, or review gate. */
  isCeremonyEvent: boolean;
  /** True when a guardian audit or retrospective is being produced. */
  isAuditOrRetro: boolean;
  /** True when the card explicitly requires structured section output. */
  forceStructured?: boolean;
}

// --- Selection logic ---

/**
 * Select the appropriate response tier for a given work item.
 *
 * Decision order (first match wins):
 *
 * 1. ceremony  — isCeremonyEvent OR isAuditOrRetro
 * 2. minimal   — XS card AND domainCount == 1 AND estimatedFileCount <= 1
 * 3. detailed  — domainCount > 1 OR estimatedFileCount > 5 OR size is L/XL OR forceStructured
 * 4. standard  — everything else
 */
export function selectTier(input: TierSelectionInput): TierDefinition {
  // 1. Ceremony events always get the ceremony tier
  if (input.isCeremonyEvent || input.isAuditOrRetro) {
    return TIER_DEFINITIONS.ceremony;
  }

  // 2. Minimal: tiny scoped work
  if (
    input.cardSize === 'XS' &&
    input.domainCount === 1 &&
    input.estimatedFileCount <= 1
  ) {
    return TIER_DEFINITIONS.minimal;
  }

  // 3. Detailed: large or cross-domain work
  if (
    input.domainCount > 1 ||
    input.estimatedFileCount > 5 ||
    input.cardSize === 'L' ||
    input.cardSize === 'XL' ||
    input.forceStructured === true
  ) {
    return TIER_DEFINITIONS.detailed;
  }

  // 4. Standard: everything else
  return TIER_DEFINITIONS.standard;
}

// --- Convenience helpers ---

/**
 * Return true when the selected tier requires a structured layout
 * (headings, sections, file lists).
 */
export function requiresStructuredOutput(tier: ResponseTier): boolean {
  return TIER_DEFINITIONS[tier].requiresStructure;
}

/**
 * Return true when Volundr must POST a quality score after completing
 * work at this tier.
 */
export function requiresQualityScore(tier: ResponseTier): boolean {
  return TIER_DEFINITIONS[tier].requiresQualityScore;
}

/**
 * Describe the tier constraints as a short instruction string
 * suitable for injecting into a persona charter or agent prompt.
 */
export function tierInstructions(tier: ResponseTier): string {
  const def = TIER_DEFINITIONS[tier];
  const parts: string[] = [
    `Response tier: ${def.label} (${def.description})`,
    `Max output: ~${def.maxTokens} tokens.`,
  ];
  if (def.requiresStructure) {
    parts.push('Use structured sections with headings.');
  }
  if (def.requiresQualityScore) {
    parts.push('POST quality score to /api/quality after completion.');
  }
  return parts.join(' ');
}
