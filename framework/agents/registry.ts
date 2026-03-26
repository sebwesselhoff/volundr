/**
 * Vǫlundr v5 - Agent Type Registry
 *
 * Reference file defining all agent types, their capabilities, and constraints.
 * Used by Vǫlundr and SubOrchestrators when spawning agents.
 * This is NOT executable code - it's a typed reference document.
 */

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
  // --- Routing metadata (Card 7: Registry Routing Hub) ---
  type?: string;              // Agent type key (mirrored for iteration convenience)
  triggerSignals?: string[];  // Keywords that trigger this agent type
  taskDepthTiers?: {          // Model selection per task scope
    small: TaskDepthTier;
    standard: TaskDepthTier;
    deep: TaskDepthTier;
  };
  defaultTraits?: string[];   // Default trait names from traits.yaml
  conditionalSpawn?: ConditionalSpawnRule | null; // Spawn rules; null = always spawned
  customizationKey?: string;  // Key for VLDR_HOME/customizations/ lookup
  pack?: string;              // Pack this agent belongs to
}

export const AGENT_REGISTRY: Record<string, AgentTypeDefinition> = {
  volundr: {
    model: 'opus-4',
    tools: ['Agent', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: null,
    canSpawn: ['planner', 'developer', 'architect', 'qa-engineer', 'devops-engineer', 'designer', 'roundtable-voice', 'chaos-engine-voice', 'guardian', 'tester', 'review', 'content', 'fixer', 'researcher'],
    sdkAccess: true,
    description: 'Project lifecycle owner. Git, merges, build gates, cross-domain coordination.',
    triggerSignals: [],
    taskDepthTiers: {
      small:    { model: 'opus-4',   maxCards: 5  },
      standard: { model: 'opus-4',   maxCards: 20 },
      deep:     { model: 'opus-4',   maxCards: 50 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'volundr',
    pack: 'core',
  },
  planner: {
    model: 'opus-4',
    tools: ['Read', 'Write', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Discovery synthesis, blueprint generation, card breakdown. Returns JSON.',
    promptTemplate: 'framework/packs/core/prompts/planner.md',
    triggerSignals: ['plan', 'blueprint', 'discovery', 'breakdown'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'opus-4', maxCards: 8 },
      deep:     { model: 'opus-4', maxCards: 8 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'planner',
    pack: 'core',
  },
  'developer': {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    isolation: 'worktree',
    description: 'Claims tasks and implements directly. No spawning subagents. Full file + shell access.',
    teammate: true,
    promptTemplate: 'framework/packs/core/prompts/developer-teammate.md',
    triggerSignals: ['implementation', 'feature', 'refactor', 'migration'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'developer',
    pack: 'core',
  },
  architect: {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Continuous design alignment, pattern enforcement, scope control',
    teammate: true,
    promptTemplate: 'framework/packs/core/prompts/architect-teammate.md',
    triggerSignals: ['architecture', 'design', 'pattern'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 3 },
      standard: { model: 'sonnet', maxCards: 8 },
      deep:     { model: 'opus',   maxCards: 8 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: null,
    customizationKey: 'architect',
    pack: 'core',
  },
  'qa-engineer': {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Test strategy, coverage tracking, test execution',
    teammate: true,
    promptTemplate: 'framework/packs/testing/prompts/qa-engineer-teammate.md',
    triggerSignals: ['test', 'coverage', 'e2e', 'integration test', 'qa', 'quality'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: {
      cardSignals: [/test/i, /coverage/i, /e2e/i, /integration test/i, /qa/i, /quality/i],
      minCards: 3,
    },
    customizationKey: 'qa-engineer',
    pack: 'testing',
  },
  'devops-engineer': {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Infrastructure, CI/CD, deployment, database migrations',
    teammate: true,
    promptTemplate: 'framework/packs/infrastructure/prompts/devops-engineer-teammate.md',
    triggerSignals: ['infra', 'deploy', 'docker', 'ci', 'pipeline', 'kubernetes'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: [],
    conditionalSpawn: {
      cardSignals: [/infra/i, /deploy/i, /docker/i, /ci/i, /pipeline/i, /kubernetes/i],
      minCards: 2,
    },
    customizationKey: 'devops-engineer',
    pack: 'infrastructure',
  },
  designer: {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'UI/UX quality, component patterns, visual consistency',
    teammate: true,
    promptTemplate: 'framework/packs/frontend/prompts/designer-teammate.md',
    triggerSignals: ['frontend', 'ui', 'ux', 'css', 'design', 'component', 'tailwind'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: ['accessibility'],
    conditionalSpawn: {
      cardSignals: [/frontend/i, /ui/i, /ux/i, /css/i, /design/i, /component/i, /tailwind/i],
      minCards: 2,
    },
    customizationKey: 'designer',
    pack: 'frontend',
  },
  'roundtable-voice': {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Blueprint review voice (temporary, roundtable only)',
    teammate: true,
    promptTemplate: 'framework/packs/roundtable/prompts/roundtable-teammate.md',
    triggerSignals: ['roundtable', 'review', 'blueprint'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 1 },
      standard: { model: 'sonnet', maxCards: 1 },
      deep:     { model: 'sonnet', maxCards: 1 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'roundtable-voice',
    pack: 'roundtable',
  },
  'chaos-engine-voice': {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Chaos Engine voice - high-intensity idea evolution (temporary, roundtable alternative)',
    teammate: true,
    promptTemplate: 'framework/packs/roundtable/prompts/chaos-engine-teammate.md',
    triggerSignals: ['chaos-engine', 'breakthrough', 'innovation', 'creative'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 1 },
      standard: { model: 'sonnet', maxCards: 1 },
      deep:     { model: 'sonnet', maxCards: 1 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'chaos-engine-voice',
    pack: 'roundtable',
  },
  developer: {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    isolation: 'worktree',
    description: 'Writes code files. Edit for modifying existing, Write for new. No Bash, no Agent.',
    promptTemplate: 'framework/packs/core/prompts/developer.md',
    triggerSignals: ['implementation', 'feature', 'refactor', 'migration'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'developer',
    pack: 'core',
  },
  tester: {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Writes and modifies test files. Returns test files + expected results.',
    promptTemplate: 'framework/packs/testing/prompts/tester.md',
    triggerSignals: ['test', 'spec', 'coverage', 'unit test', 'integration test'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 4 },
      deep:     { model: 'opus',   maxCards: 4 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: null,
    customizationKey: 'tester',
    pack: 'testing',
  },
  review: {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Cross-domain code review. Spawned as teammate when cross-deps > 5.',
    teammate: true,
    promptTemplate: 'framework/packs/quality/prompts/review.md',
    triggerSignals: ['review', 'cross-domain', 'quality'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'opus',   maxCards: 6 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: null,
    customizationKey: 'reviewer',
    pack: 'core',
  },
  content: {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Docs, READMEs, markdown content. No code files.',
    promptTemplate: 'framework/packs/infrastructure/prompts/content.md',
    triggerSignals: ['docs', 'readme', 'documentation', 'content', 'markdown'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 6 },
      deep:     { model: 'sonnet', maxCards: 6 },
    },
    defaultTraits: [],
    conditionalSpawn: null,
    customizationKey: 'content',
    pack: 'core',
  },
  fixer: {
    model: 'haiku-4',
    tools: ['Read', 'Write', 'Edit'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Targeted build-gate fix. Receives error + source, returns patch. Fast, cheap.',
    promptTemplate: 'framework/packs/quality/prompts/fixer.md',
    triggerSignals: ['fix', 'bug', 'error', 'patch', 'build-gate'],
    taskDepthTiers: {
      small:    { model: 'haiku', maxCards: 1 },
      standard: { model: 'haiku', maxCards: 3 },
      deep:     { model: 'sonnet', maxCards: 3 },
    },
    defaultTraits: ['fast', 'cautious'],
    conditionalSpawn: null,
    customizationKey: 'fixer',
    pack: 'quality',
  },
  guardian: {
    model: 'opus-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Architecture review at milestones. Spawned as teammate.',
    teammate: true,
    promptTemplate: 'framework/packs/quality/prompts/guardian-teammate.md',
    triggerSignals: ['architecture', 'milestone', 'review', 'security', 'quality'],
    taskDepthTiers: {
      small:    { model: 'opus', maxCards: 2 },
      standard: { model: 'opus', maxCards: 6 },
      deep:     { model: 'opus', maxCards: 6 },
    },
    defaultTraits: ['thorough', 'security'],
    conditionalSpawn: null,
    customizationKey: 'guardian',
    pack: 'quality',
  },
  researcher: {
    model: 'opus-4',
    tools: ['Agent', 'WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    teammate: true,
    promptTemplate: 'framework/packs/research/prompts/researcher-teammate.md',
    description: 'Pre-study researcher. Web search, API docs, wiki, Playwright browser, curl probing. Produces reports + typed mappings.',
    triggerSignals: ['api', 'integration', 'webhook', 'oauth', 'third-party', 'external'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'opus',   maxCards: 4 },
      deep:     { model: 'opus',   maxCards: 4 },
    },
    defaultTraits: [],
    conditionalSpawn: {
      cardSignals: [/api/i, /integration/i, /webhook/i, /oauth/i, /third.party/i, /external/i],
      minCards: 1,
    },
    customizationKey: 'researcher',
    pack: 'research',
  },
};

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
