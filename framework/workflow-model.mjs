#!/usr/bin/env node
/**
 * workflow-model.mjs — role→model tiering for Workflow-tool agent() authoring (FRW-BL-075)
 *
 * WHY THIS EXISTS
 *   The Workflow tool's `agent(prompt, opts)` call, authored WITHOUT `opts.model`, does NOT inherit
 *   the main-loop (session) model as the tool docs imply — empirically it resolves to Haiku for
 *   EVERY workflow subagent, including synthesis/critic/review roles that need real judgment.
 *   Observed on ata-mcp (TOOL-001 / PIPE-004): 106/106 model refs were Haiku with no env override;
 *   architectural SYNTHESIS ran on Haiku (below-bar judgment), and strict structured-output schemas
 *   (additionalProperties:false + many required) triggered repeated schema-validation RETRIES on
 *   Haiku (~5x wall-clock, 9 agent transcripts for a 4-agent workflow). Quality survived only
 *   because an Opus main loop + a Sonnet blind reviewer re-checked everything — a safety net that
 *   MASKED a silent mis-tier. This module + its guidance remove the reliance on that mask.
 *
 * WHAT THIS MODULE IS
 *   The CANONICAL, tested role→tier map + a resolver, mirroring hierarchy-config.ts MODEL_TIERS
 *   (haiku < sonnet < opus). It is the single source of truth the Workflow-authoring guidance
 *   (framework/system-instructions.md § "Workflow-Tool Model Tiering (FRW-BL-075)") points at.
 *
 *   SCOPE (matches FRW-BL-075 exactly): ONLY the Workflow-tool authoring path. It does NOT touch
 *   Volundr's registry-driven teammate/subagent tiering (FRW-BL-031 / hierarchy-config MODEL_TIERS),
 *   which already works, nor the built-in Explore agent (locate-only on Haiku is correct for breadth
 *   search).
 *
 * SANDBOX NOTE (why the map is ALSO documented inline in the guidance):
 *   Workflow scripts run in a sandbox with NO filesystem / Node.js module access — a workflow script
 *   CANNOT `import` this file at runtime. Authors therefore apply the map by following the documented
 *   rule (always pass `opts.model` for synthesis/critic/implementation/review roles), optionally
 *   inlining the tiny map from the guidance. This module is the tested reference those inline maps
 *   mirror, and is directly usable by tooling / the main loop OUTSIDE the sandbox — the same pattern
 *   as scenario-router.mjs mirroring TIER_ORDER locally rather than importing the TS config.
 *
 * PUBLIC API:
 *   constants — TIER_ORDER, SAFE_DEFAULT_TIER, MODEL_LABEL_SEP, WORKFLOW_ROLE_TIERS
 *   resolveWorkflowModel(role, {strictSchema?}) -> tier
 *   workflowModelOpts(role, {label?, strictSchema?, ...passthrough}) -> agent() opts with model+label
 *   describeResolution(role, {strictSchema?}) -> log()-friendly one-liner
 *   isDefaultHaikuRisk(role, {strictSchema?}) -> boolean (role that MUST pass an explicit model)
 *
 * Pure Node ESM, NO external deps. Exported functions are pure (no I/O, no globals) so they
 * unit-test in isolation. Self-test: framework/workflow-model.test.mjs
 * (run: `node framework/workflow-model.test.mjs`).
 */

/**
 * Tier order LOW -> HIGH, mirroring hierarchy-config.ts MODEL_TIERS.escalation.tierOrder
 * (['haiku','sonnet','opus']). Higher index = more capable / costlier. Mirrored locally on purpose
 * (a workflow / worktree context must not import the TS config without a tsc toolchain).
 * @type {readonly ['haiku','sonnet','opus']}
 */
export const TIER_ORDER = Object.freeze(['haiku', 'sonnet', 'opus']);

/**
 * SAFE_DEFAULT_TIER — what an UNKNOWN or unspecified workflow role resolves to. Deliberately
 * 'sonnet', NEVER 'haiku': the entire point of FRW-BL-075 is that an unrecognised or forgotten role
 * must not silently fall to Haiku. Sonnet is the standard implementation tier (== the 'standard'
 * tier / MODEL_TIERS.standard) — a safe floor for any judgment-bearing work.
 * @type {'sonnet'}
 */
export const SAFE_DEFAULT_TIER = 'sonnet';

/** Separator used when a resolved model is appended to an agent label for observability (ISC-3). */
export const MODEL_LABEL_SEP = ':';

/**
 * Canonical workflow-authoring role -> tier map, grouped by the three buckets FRW-BL-075 names.
 * Common author-phrasing aliases are included so a natural role name resolves without guessing.
 * Keys are lower-case; lookups normalise (trim + lower-case) first.
 *
 *   haiku  (cheap / mechanical): pure locate / extract / format / classify work — NO judgment.
 *   sonnet (standard):           comprehension reading, implementation, review / verify / test.
 *   opus   (deep):               synthesis, architecture / design, judging, high-risk review.
 *
 * @type {Readonly<Record<string, 'haiku'|'sonnet'|'opus'>>}
 */
export const WORKFLOW_ROLE_TIERS = Object.freeze({
  // --- haiku: mechanical, no-judgment ---
  locate: 'haiku', find: 'haiku', search: 'haiku', grep: 'haiku',
  extract: 'haiku', scrape: 'haiku', collect: 'haiku', gather: 'haiku',
  mechanical: 'haiku', format: 'haiku', rename: 'haiku', classify: 'haiku',
  dedupe: 'haiku', tally: 'haiku', count: 'haiku',

  // --- sonnet: standard comprehension / build / check ---
  read: 'sonnet', comprehension: 'sonnet', 'comprehension-reader': 'sonnet', reader: 'sonnet',
  summarize: 'sonnet', summarise: 'sonnet', explain: 'sonnet',
  implement: 'sonnet', implementation: 'sonnet', develop: 'sonnet', code: 'sonnet',
  transform: 'sonnet', migrate: 'sonnet', refactor: 'sonnet', fix: 'sonnet',
  review: 'sonnet', verify: 'sonnet', validate: 'sonnet', test: 'sonnet', check: 'sonnet',
  research: 'sonnet',

  // --- opus: deep judgment / architecture / high-risk ---
  synthesis: 'opus', synthesize: 'opus', synthesise: 'opus',
  architecture: 'opus', architect: 'opus', design: 'opus', plan: 'opus',
  judge: 'opus', critic: 'opus', critique: 'opus', evaluate: 'opus',
  'high-risk-review': 'opus', 'security-review': 'opus', adversarial: 'opus',
});

/** Index of a tier in TIER_ORDER (LOW->HIGH), or -1 if unknown. */
function tierIndex(tier) {
  return TIER_ORDER.indexOf(tier);
}

/** True iff `tier` is one of the recognised tier names. */
function isValidTier(tier) {
  return typeof tier === 'string' && tierIndex(tier) >= 0;
}

/**
 * Return whichever of two tiers is higher (more capable). A valid tier beats an unknown one; if
 * BOTH are unrecognised, `a` is returned unchanged (unreachable in practice — every caller passes at
 * least one known tier, e.g. the 'sonnet' floor in resolveWorkflowModel).
 */
function maxTier(a, b) {
  const ia = tierIndex(a);
  const ib = tierIndex(b);
  if (ia < 0) return isValidTier(b) ? b : a;
  if (ib < 0) return a;
  return ia >= ib ? a : b;
}

/** Normalise a role token: string -> trimmed, lower-cased; anything else -> ''. */
function normRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

/**
 * Resolve the model tier for a workflow agent role.
 *
 *   - Known role          -> its mapped tier.
 *   - Unknown / empty role -> SAFE_DEFAULT_TIER ('sonnet'), NEVER 'haiku' (the FRW-BL-075 guarantee).
 *   - strictSchema:true    -> floor the result at 'sonnet' (a strict structured-output schema —
 *     additionalProperties:false + many required fields — fails-and-retries on Haiku; ISC-4). Never
 *     DOWNGRADES an already-higher tier (opus stays opus).
 *
 * @param {string} role
 * @param {{ strictSchema?: boolean }} [opts]
 * @returns {'haiku'|'sonnet'|'opus'}
 */
export function resolveWorkflowModel(role, { strictSchema = false } = {}) {
  const key = normRole(role);
  // Guard the lookup: only an OWN key mapping to a VALID tier counts. This rejects inherited
  // Object.prototype keys ('constructor', '__proto__', 'toString', 'hasOwnProperty', …) that a bare
  // bracket lookup would otherwise return as a truthy function/object — a forgotten or hostile role
  // name must fall through to SAFE_DEFAULT_TIER, never to a non-tier value (FRW-BL-075 verify pass).
  const mapped = key && Object.hasOwn(WORKFLOW_ROLE_TIERS, key) ? WORKFLOW_ROLE_TIERS[key] : undefined;
  let tier = isValidTier(mapped) ? mapped : SAFE_DEFAULT_TIER;
  if (strictSchema) tier = maxTier(tier, 'sonnet');
  return tier;
}

/**
 * Build the opts object to spread into a Workflow `agent()` call, with the resolved model AND an
 * observability label that ENCODES that model (ISC-3): the resolved tier becomes visible in the
 * /workflows progress tree and in logs, so a silent Haiku default is immediately detectable.
 * Pass-through of `effort` / `agentType` / `isolation` / `phase` / `schema` is preserved; the
 * internal `label` / `strictSchema` keys are consumed (never leaked into the agent opts as-is).
 *
 *   workflowModelOpts('synthesis')                      -> { model:'opus',   label:'synthesis:opus' }
 *   workflowModelOpts('review', { label:'sec' })        -> { model:'sonnet', label:'sec:sonnet' }
 *   workflowModelOpts('extract', { strictSchema:true }) -> { model:'sonnet', label:'extract:sonnet' }
 *   agent(prompt, workflowModelOpts('synthesis', { schema: PLAN_SCHEMA }))
 *
 * @param {string} role
 * @param {{ label?:string, strictSchema?:boolean, effort?:string, agentType?:string,
 *           isolation?:string, phase?:string, schema?:object }} [opts]
 * @returns {object} opts safe to spread into agent(prompt, ...)
 */
export function workflowModelOpts(role, opts = {}) {
  const safe = opts && typeof opts === 'object' ? opts : {};
  const { label, strictSchema, ...passthrough } = safe;
  const model = resolveWorkflowModel(role, { strictSchema });
  const base = (typeof label === 'string' && label.trim()) ? label.trim() : (normRole(role) || 'agent');
  return { ...passthrough, model, label: `${base}${MODEL_LABEL_SEP}${model}` };
}

/**
 * One-line, log()-friendly description of a role's resolution — for `log()` inside a workflow when
 * you want the resolved model in the narrator stream, not only on the agent label (ISC-3).
 *   describeResolution('synthesis') -> "workflow model: synthesis -> opus"
 *
 * @param {string} role
 * @param {{ strictSchema?: boolean }} [opts]
 * @returns {string}
 */
export function describeResolution(role, opts = {}) {
  return `workflow model: ${normRole(role) || '(unspecified)'} -> ${resolveWorkflowModel(role, opts)}`;
}

/**
 * True iff relying on the WORKFLOW DEFAULT (Haiku) would MIS-TIER this role — i.e. the role resolves
 * ABOVE haiku and therefore MUST pass an explicit `opts.model`. Lets an author guard or linter flag
 * a synthesis/critic/review/implementation agent() that forgot its model.
 *
 * @param {string} role
 * @param {{ strictSchema?: boolean }} [opts]
 * @returns {boolean}
 */
export function isDefaultHaikuRisk(role, opts = {}) {
  return resolveWorkflowModel(role, opts) !== 'haiku';
}
