/**
 * Model resolution — the single derivation point for which Claude model an agent runs on.
 *
 * SINGLE SOURCE OF TRUTH (FRW-BL-077): role->tier, tier ordering, and tier->alias live ONLY in
 * `hierarchy-config.ts` MODEL_TIERS. This module adds the economy-downgrade + explicit-override
 * LAYER on top and returns TIER ALIASES ('haiku' | 'sonnet' | 'opus') — never version-pinned model
 * IDs. Claude Code resolves each alias to a concrete model via the ANTHROPIC_DEFAULT_*_MODEL env
 * vars pinned in `.claude/settings.json` (see `framework/guardrails.md` ISC-3). Because no version
 * number appears in this file, a model-family bump touches ONLY settings.json — this layer cannot
 * drift.
 *
 * Supersedes the earlier per-agent DEFAULT_MODELS + ECONOMY_DOWNGRADES tables (removed): they
 * duplicated MODEL_TIERS.roles with version-pinned IDs, disagreed with it on several roles, and had
 * silently drifted a whole model generation out of date (FRW-BL-076 found opus-4-6 still pinned).
 *
 * CARD-GV-003, FRW-BL-077
 */

import { MODEL_TIERS } from './hierarchy-config.js';

/** Tier aliases, low -> high capability. Mirrors MODEL_TIERS.escalation.tierOrder. */
export type Tier = 'haiku' | 'sonnet' | 'opus';

/** Ordered tiers (low -> high) — the sole ladder for economy step-down and escalation. */
const TIER_ORDER: readonly string[] = MODEL_TIERS.escalation.tierOrder;

/** Tier used for any role not explicitly mapped in MODEL_TIERS.roles. */
const DEFAULT_TIER: string = MODEL_TIERS.standard; // 'sonnet'

/**
 * Roles that are NEVER downgraded in economy mode. The `volundr` lead orchestrates the entire run;
 * dropping its capability to shave cost is a false economy, so it always stays at its full tier.
 */
export const NON_DOWNGRADABLE_ROLES: ReadonlySet<string> = new Set(['volundr']);

/** Map a tier to its Agent-tool alias via MODEL_TIERS.modelIds (identity today; an indirection point). */
function aliasFor(tier: string): string {
  const ids = MODEL_TIERS.modelIds as Record<string, string>;
  // Object.hasOwn guard: an inherited prototype key ('toString', 'constructor', …) must not leak a
  // function/object out of the bracket lookup — pass the tier through unchanged instead (FRW-BL-077).
  return Object.hasOwn(ids, tier) ? ids[tier] : tier;
}

/** Step a tier DOWN one step toward haiku (economy). Floors at haiku; unknown tiers pass through. */
export function stepDownTier(tier: string): string {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0) return tier; // unknown tier -> unchanged (defensive; never invents a tier)
  return TIER_ORDER[Math.max(i - 1, 0)];
}

/** The base (normal-mode) tier alias for an agent type, from the MODEL_TIERS single source of truth. */
export function baseTierForAgentType(agentType: string): string {
  const roles = MODEL_TIERS.roles;
  // Object.hasOwn guard so a role named after an Object.prototype member ('constructor', 'toString',
  // '__proto__', …) resolves to the standard tier, not a leaked inherited value — `?? DEFAULT_TIER`
  // alone would NOT catch it (inherited props aren't nullish). Keeps the resolver total (FRW-BL-077).
  return Object.hasOwn(roles, agentType) ? roles[agentType] : DEFAULT_TIER;
}

/**
 * Resolve the model ALIAS an agent should run on.
 *
 * Precedence: explicit override (returned verbatim, never downgraded) > economy step-down > base tier.
 * Economy steps every role down exactly one tier (opus -> sonnet -> haiku, floored at haiku), EXCEPT
 * roles in NON_DOWNGRADABLE_ROLES (the volundr lead), which stay at their full tier.
 *
 * Returns a tier alias ('haiku' | 'sonnet' | 'opus'); Claude Code resolves it to a concrete model via
 * the settings.json ANTHROPIC_DEFAULT_*_MODEL pins. Total: always returns a value, never throws.
 */
export function resolveModelForAgentType(
  agentType: string,
  economyMode = false,
  explicitOverride?: string,
): string {
  if (explicitOverride) return explicitOverride; // overrides are never downgraded
  const base = baseTierForAgentType(agentType);
  if (!economyMode || NON_DOWNGRADABLE_ROLES.has(agentType)) return aliasFor(base);
  return aliasFor(stepDownTier(base));
}

/**
 * Lower-level tier resolver: apply the economy downgrade to an already-known base tier/alias.
 * Explicit override wins (verbatim); otherwise step down one tier when economy is on. Returns an
 * alias. Role-unaware — use resolveModelForAgentType when the volundr-exempt rule must apply.
 */
export function resolveModel(
  baseTier: string,
  economyMode: boolean,
  explicitOverride?: string,
): string {
  if (explicitOverride) return explicitOverride;
  if (!economyMode) return aliasFor(baseTier);
  return aliasFor(stepDownTier(baseTier));
}
