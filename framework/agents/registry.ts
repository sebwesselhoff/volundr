/**
 * Volundr v5 - Agent Type Registry (TYPED VIEW)
 *
 * The DATA now lives in `registry.data.mjs` (plain JS) so pure-Node tooling —
 * notably `generate-agents.mjs`, which emits the native `.claude/agents/*.md`
 * Claude Code agent definitions — can consume it WITHOUT tsc/ts-node (FRW-BL-037).
 * This file imports that data and re-exports it strongly typed, PRESERVING the
 * historical export surface: `AGENT_REGISTRY`, `AGENT_REGISTRY_LIST`, the
 * interfaces, `TOKEN_ESTIMATES`, `WORKER_LIMITS`, `TEAMMATE_LIMITS`.
 * (`hierarchy-assessor.ts` imports `AGENT_REGISTRY_LIST` from here unchanged.)
 *
 * SINGLE SOURCE OF TRUTH: to change agent definitions, edit `registry.data.mjs`,
 * then run `node framework/agents/generate-agents.mjs` to regenerate the native
 * defs. Do NOT hand-edit `.claude/agents/*.md`.
 */

// Plain-JS data module (RegExp literals + no tsc needed). The `import type` below
// is purely for documentation; the value import is what binds AGENT_REGISTRY_DATA.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — sibling .mjs has no .d.ts; it is given the typed shape on re-export.
import { AGENT_REGISTRY_DATA } from './registry.data.mjs';

export interface ConditionalSpawnRule {
  cardSignals: RegExp[];   // Regex patterns matched against card text
  minCards: number;        // Minimum matching cards required to trigger spawn
}

export interface TaskDepthTier {
  model: string;
  maxCards: number;
}

export interface AgentTypeDefinition {
  model: string;
  tools: string[];
  spawnedBy: string[] | null;
  canSpawn: string[];
  sdkAccess: boolean;
  isolation?: 'worktree';
  description: string;
  teammate?: boolean;         // true = spawned as Agent Teams teammate, not Agent tool subagent
  promptTemplate?: string;    // path to prompt template file
  personaTemplate?: string;   // default persona ID from framework/personas/seeds/
  // --- Routing metadata (Card 7: Registry Routing Hub) ---
  type?: string;              // Agent type key (mirrored for iteration convenience)
  triggerSignals?: string[];  // Keywords that trigger this agent type
  whenToUse?: string;         // FRW-BL-057: natural-language delegation cue. Used as the
                              // TIEBREAKER when triggerSignals multi-match (keyword routing is
                              // ambiguous, e.g. developer vs developer-subagent, qa-engineer vs
                              // tester) — pick the agent type whose whenToUse best fits the card.
  taskDepthTiers?: {          // Model selection per task scope
    small: TaskDepthTier;
    standard: TaskDepthTier;
    deep: TaskDepthTier;
  };
  defaultTraits?: string[];   // Default trait names from traits.yaml
  conditionalSpawn?: ConditionalSpawnRule | null; // Spawn rules; null = always spawned
  customizationKey?: string;  // Key for VLDR_HOME/customizations/ lookup
  pack?: string;              // Pack this agent belongs to
  // --- FRW-BL-037: native Claude Code agent-definition frontmatter fields ---
  // Emitted into the generated `.claude/agents/<name>.md` defs. See
  // framework/cc-version-baseline.md for the CC version floors.
  permissionMode?: 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';
                              // Read-only roles (architect, guardian, review) set 'plan'
                              // to enforce read-only NATIVELY instead of via prose.
  effort?: string;            // CLAUDE_CODE_EFFORT_LEVEL hint for the agent (e.g. 'high').
  maxTurns?: number;          // Per-agent turn budget (mirrors the historical defs).
  skills?: string[];          // Skills to preload into the agent's context.
  memory?: string;            // Memory scope (e.g. 'project') for persistent auditors.
  initialPrompt?: string;     // Optional initial prompt seeded on spawn.
}

/**
 * The agent registry. DATA is sourced from `registry.data.mjs` (the single source
 * of truth, also consumed by `generate-agents.mjs`) and re-exported here with the
 * `AgentTypeDefinition` type applied. The data module has no `.d.ts`, so it is
 * imported untyped and given the registry shape on this re-export; consumers see
 * the fully-typed `Record<string, AgentTypeDefinition>` exactly as before.
 */
export const AGENT_REGISTRY: Record<string, AgentTypeDefinition> =
  AGENT_REGISTRY_DATA as Record<string, AgentTypeDefinition>;

/**
 * Flat array of all registry entries with their type key mirrored.
 * Useful for iteration (e.g. in hierarchy-assessor buildConditionalTeammates).
 */
export const AGENT_REGISTRY_LIST = Object.entries(AGENT_REGISTRY).map(
  ([type, def]) => ({ type, ...def }),
);

/**
 * Token estimates per card size (used for cost estimation)
 */
export const TOKEN_ESTIMATES = {
  S:  { prompt: 8_000,  completion: 12_000 },
  M:  { prompt: 15_000, completion: 25_000 },
  L:  { prompt: 30_000, completion: 45_000 },
  XL: { prompt: 50_000, completion: 80_000 },
} as const;

/**
 * Per-SubOrc worker limits
 */
export const WORKER_LIMITS = {
  developer: 3,
  tester: 2,
  review: 1,
  content: 3,
  fixer: 2,
} as const;

/**
 * Agent Teams teammate limits
 */
export const TEAMMATE_LIMITS = {
  maxTeammates: 12,              // Including Volundr (team lead)
  maxDevelopers: 4,              // Max concurrent developer teammates
  maxReviewers: 1,               // Cross-domain reviewer
  maxGuardians: 1,               // Architecture guardian
  maxResearchers: 2,             // Max concurrent research teammates
  subagentsPerSubOrc: 3,         // Max concurrent developer subagents per SubOrc (matches WORKER_LIMITS.developer)
} as const;
