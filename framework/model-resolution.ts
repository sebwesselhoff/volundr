/**
 * Model resolution — determines which Claude model to use for each agent type
 * based on economy mode and any explicit overrides.
 *
 * CARD-GV-003
 */

/** Model downgrades applied in economy mode */
const ECONOMY_DOWNGRADES: Record<string, string> = {
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001', // floor
  // Legacy aliases
  'opus-4': 'sonnet-4',
  'sonnet-4': 'haiku-4',
  'haiku-4': 'haiku-4',
};

/**
 * Resolve the model to use for an agent.
 *
 * @param baseModel - The default model for this agent type
 * @param economyMode - Whether economy mode is enabled on the project
 * @param explicitOverride - An explicit model override (never downgraded)
 * @returns The resolved model string
 */
export function resolveModel(
  baseModel: string,
  economyMode: boolean,
  explicitOverride?: string,
): string {
  // Explicit overrides are never downgraded
  if (explicitOverride) return explicitOverride;

  if (!economyMode) return baseModel;

  return ECONOMY_DOWNGRADES[baseModel] ?? baseModel;
}

/** Default models per agent type (normal mode) */
export const DEFAULT_MODELS: Record<string, string> = {
  volundr: 'claude-opus-4-6',
  architect: 'claude-opus-4-6',
  developer: 'claude-sonnet-4-6',
  'qa-engineer': 'claude-sonnet-4-6',
  'devops-engineer': 'claude-sonnet-4-6',
  designer: 'claude-sonnet-4-6',
  reviewer: 'claude-sonnet-4-6',
  guardian: 'claude-sonnet-4-6',
  researcher: 'claude-sonnet-4-6',
  content: 'claude-sonnet-4-6',
  fixer: 'claude-sonnet-4-6',
  planner: 'claude-sonnet-4-6',
};

/**
 * Get the resolved model for a given agent type and economy mode state.
 */
export function resolveModelForAgentType(
  agentType: string,
  economyMode: boolean,
  explicitOverride?: string,
): string {
  const base = DEFAULT_MODELS[agentType] ?? 'claude-sonnet-4-6';
  return resolveModel(base, economyMode, explicitOverride);
}
