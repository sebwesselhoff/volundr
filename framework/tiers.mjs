/**
 * tiers.mjs — the single model-tier order (FRW-BL-085).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The tier order was hand-mirrored in three modules, each carrying a comment explaining that it
 * could not import `hierarchy-config.ts` for lack of a tsc toolchain:
 *
 *   framework/scenario-router.mjs   ['haiku','sonnet','opus']   (low -> high)
 *   framework/workflow-model.mjs    ['haiku','sonnet','opus']   (low -> high)
 *   scripts/budget-controller.mjs   ['opus','sonnet','haiku']   (HIGH -> LOW)  <-- reversed
 *
 * The tsc argument is sound for the `.ts` file and irrelevant to importing a sibling `.mjs`
 * (budget-controller already imports `./notify-event.mjs`). The reversed third copy was a live
 * hazard: a contributor who read two of the three and assumed a consistent direction would write
 * an off-by-direction escalation — silently upgrading where they meant to downgrade.
 *
 * This is the same duplicate-encoding drift class that FRW-BL-077 and FRW-BL-078 already fixed
 * twice (MODEL_TIERS vs model-resolution.ts). One encoding, imported everywhere.
 *
 * DIRECTION IS NAMED, NEVER IMPLIED
 * ---------------------------------
 * `TIER_ORDER` is canonical and ascending (index = capability rank; higher = more capable and
 * costlier). Consumers that walk downward import `TIER_ORDER_DESC` **by name** rather than
 * declaring their own reversed literal, so the direction is visible at the import site.
 *
 * RELATIONSHIP TO hierarchy-config.ts
 * -----------------------------------
 * `hierarchy-config.ts` remains the source of truth for role -> tier assignment and for the
 * escalation `tierOrder`. This module mirrors ONLY the tier order, and `tiers.test.mjs` asserts
 * the two agree by reading the `.ts` file as text — the one gap an import genuinely cannot close
 * without a toolchain. Concrete model versions live solely in `.claude/settings.json`
 * (see framework/model-tiering.md).
 *
 * Pure data. No dependencies. Safe to import from framework/ and scripts/ alike.
 */

/**
 * Canonical tier order, LOW -> HIGH. Index = capability rank.
 * @type {readonly ['haiku','sonnet','opus']}
 */
export const TIER_ORDER = Object.freeze(['haiku', 'sonnet', 'opus']);

/**
 * The same order reversed, HIGH -> LOW — for downgrade / fallback ladders that walk toward the
 * cheapest tier. Derived, never re-typed, so it cannot drift from TIER_ORDER.
 * @type {readonly ['opus','sonnet','haiku']}
 */
export const TIER_ORDER_DESC = Object.freeze([...TIER_ORDER].reverse());

/** Cheapest tier. */
export const FLOOR_TIER = TIER_ORDER[0];

/** Most capable tier. */
export const CEIL_TIER = TIER_ORDER[TIER_ORDER.length - 1];

/**
 * Capability rank of a tier (0 = cheapest), or -1 if unknown.
 * Direction-independent: always ranks against the ascending canonical order.
 */
export function tierRank(tier) {
  return TIER_ORDER.indexOf(tier);
}
