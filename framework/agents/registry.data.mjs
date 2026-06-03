/**
 * registry.data.mjs — Volundr Agent Type Registry DATA (FRW-BL-037)
 *
 * The plain-JS AGENT_REGISTRY data object, split out of registry.ts so it can be
 * consumed by pure-Node tooling (generate-agents.mjs) WITHOUT tsc/ts-node.
 *
 * registry.ts imports `AGENT_REGISTRY_DATA` from here and re-exports it typed as
 * `AGENT_REGISTRY: Record<string, AgentTypeDefinition>` — preserving the exact
 * historical export surface. Keep this file the SINGLE SOURCE for the data; the
 * .ts file is the typed view + extra typed exports only.
 *
 * RegExp literals in `conditionalSpawn.cardSignals` are valid plain JS here.
 *
 * Per-agent CC native-frontmatter fields (FRW-BL-037 / cc-version-baseline.md):
 *   permissionMode  'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'
 *                   — set 'plan' on the read-only roles (architect, guardian, review)
 *                     so they enforce read-only NATIVELY, not via prose.
 *   maxTurns        per-agent turn budget (mirrors the historical .claude/agents defs).
 *   memory          'project' (read-only auditors keep project memory across turns).
 *   effort, skills, initialPrompt — optional, emitted into the native def when set.
 *
 * @typedef {Object} AgentTypeDefinitionData
 * @property {string} model
 * @property {string[]} tools
 * @property {string[]|null} spawnedBy
 * @property {string[]} canSpawn
 * @property {boolean} sdkAccess
 * @property {string} description
 * @property {'worktree'} [isolation]
 * @property {boolean} [teammate]
 * @property {string} [promptTemplate]
 * @property {string} [personaTemplate]
 * @property {string} [type]
 * @property {string[]} [triggerSignals]
 * @property {string} [whenToUse]
 * @property {object} [taskDepthTiers]
 * @property {string[]} [defaultTraits]
 * @property {object|null} [conditionalSpawn]
 * @property {string} [customizationKey]
 * @property {string} [pack]
 * @property {'plan'|'default'|'acceptEdits'|'bypassPermissions'} [permissionMode]
 * @property {string} [effort]
 * @property {number} [maxTurns]
 * @property {string[]} [skills]
 * @property {string} [memory]
 * @property {string} [initialPrompt]
 */

/** @type {Record<string, AgentTypeDefinitionData>} */
export const AGENT_REGISTRY_DATA = {
  volundr: {
    model: 'opus-4',
    tools: ['Agent', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: null,
    canSpawn: ['planner', 'developer', 'architect', 'qa-engineer', 'devops-engineer', 'designer', 'roundtable-voice', 'chaos-engine-voice', 'guardian', 'tester', 'review', 'content', 'fixer', 'researcher', 'debugger', 'performance-engineer', 'security-auditor'],
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
    whenToUse: 'Two-level/teammate mode: an Agent Teams teammate that claims MULTIPLE cards in a domain and needs Bash + worktree. Prefer over `developer-subagent` when >5 cards or a domain needs sustained multi-card ownership.',
    teammate: true,
    promptTemplate: 'framework/packs/core/prompts/developer-teammate.md',
    personaTemplate: 'fullstack-web',
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
    maxTurns: 50,
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
    personaTemplate: 'architect',
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
    // Read-only role: enforce plan mode natively (no Write/Edit/Bash).
    permissionMode: 'plan',
    maxTurns: 30,
    memory: 'project',
  },
  'qa-engineer': {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Test strategy, coverage tracking, test execution',
    whenToUse: 'Owns test STRATEGY end-to-end as a persistent teammate: writes tests, runs the suite, tracks coverage. Prefer over `tester` when testing is an ongoing domain, not a single file.',
    teammate: true,
    promptTemplate: 'framework/packs/testing/prompts/qa-engineer-teammate.md',
    personaTemplate: 'test-engineer',
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
    maxTurns: 40,
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
    personaTemplate: 'devops-infra',
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
    maxTurns: 40,
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
    personaTemplate: 'fullstack-web',
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
    maxTurns: 40,
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
  'developer-subagent': {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    isolation: 'worktree',
    description: 'Subagent developer. Writes code files. No Bash, no Agent. For flat hierarchy direct spawns.',
    whenToUse: 'Flat-hierarchy mode: a single Agent-tool subagent for ONE card, file-only (no Bash, no spawning). Prefer over `developer` when ≤5 cards or a one-off card with no shell needs.',
    promptTemplate: 'framework/packs/core/prompts/developer.md',
    personaTemplate: 'fullstack-web',
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
    whenToUse: 'Writes/modifies specific test FILES and returns them (subagent, no suite ownership). Prefer over `qa-engineer` for a bounded "add tests for X" task.',
    promptTemplate: 'framework/packs/testing/prompts/tester.md',
    personaTemplate: 'test-engineer',
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
    whenToUse: 'Per-round CROSS-DOMAIN code review while work is in flight (spawned when cross-deps>5). Prefer over `guardian` for ongoing inter-card consistency, not a milestone audit.',
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
    // Read-only role: enforce plan mode natively (Bash for git/log inspection only).
    permissionMode: 'plan',
    maxTurns: 30,
  },
  content: {
    model: 'sonnet-4',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Docs, READMEs, markdown content. No code files.',
    promptTemplate: 'framework/packs/infrastructure/prompts/content.md',
    personaTemplate: 'documentation-engineer',
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
    maxTurns: 10,
  },
  guardian: {
    model: 'opus-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    description: 'Architecture review at milestones. Spawned as teammate.',
    whenToUse: 'MILESTONE full-codebase architecture audit (domain completion / every 15 cards / pre-integration). Prefer over `review` for systemic drift and accumulated debt only visible at scale.',
    teammate: true,
    promptTemplate: 'framework/packs/quality/prompts/guardian-teammate.md',
    personaTemplate: 'security-reviewer',
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
    // Read-only role: enforce plan mode natively (Bash for read-only audit commands only).
    permissionMode: 'plan',
    maxTurns: 40,
    memory: 'project',
  },
  researcher: {
    model: 'opus-4',
    tools: ['Agent', 'WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    teammate: true,
    promptTemplate: 'framework/packs/research/prompts/researcher-teammate.md',
    personaTemplate: 'architect',
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
    maxTurns: 60,
  },
  // --- FRW-BL-056: dedicated diagnosis/perf/security roles ---
  debugger: {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    teammate: true,
    description: 'Root-cause diagnosis of bugs/crashes/regressions. Reproduces + isolates the cause; does NOT patch.',
    whenToUse: 'Root-cause DIAGNOSIS of a bug/crash/regression/flaky test (read + reproduce, no patching). Prefer over `fixer` (which applies a known build-gate patch) when the cause is UNKNOWN and needs investigation; hands the diagnosis to a developer/fixer to implement.',
    promptTemplate: 'framework/packs/quality/prompts/debugger.md',
    personaTemplate: 'architect',
    triggerSignals: ['bug', 'crash', 'regression', 'flaky', 'root cause', 'stack trace', 'debug', 'heisenbug'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 4 },
      deep:     { model: 'opus',   maxCards: 4 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: {
      cardSignals: [/\bbug\b/i, /crash/i, /regression/i, /flaky/i, /root.?cause/i, /stack trace/i],
      minCards: 1,
    },
    customizationKey: 'debugger',
    pack: 'quality',
  },
  'performance-engineer': {
    model: 'sonnet-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    teammate: true,
    description: 'Performance investigation + optimization: profiling, latency/throughput/memory, benchmarks.',
    whenToUse: 'Performance work (profiling, latency/throughput/memory, benchmarks). Prefer over a generic developer when the card is explicitly about MEASURING/IMPROVING performance rather than feature delivery.',
    promptTemplate: 'framework/packs/quality/prompts/performance-engineer.md',
    personaTemplate: 'architect',
    triggerSignals: ['performance', 'latency', 'throughput', 'profiling', 'optimization', 'slow', 'memory leak', 'benchmark', 'bottleneck'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'sonnet', maxCards: 4 },
      deep:     { model: 'opus',   maxCards: 4 },
    },
    defaultTraits: ['thorough'],
    conditionalSpawn: {
      cardSignals: [/performance/i, /latency/i, /throughput/i, /profiling/i, /\bslow\b/i, /benchmark/i, /bottleneck/i],
      minCards: 1,
    },
    customizationKey: 'performance-engineer',
    pack: 'quality',
  },
  'security-auditor': {
    model: 'opus-4',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    spawnedBy: ['volundr'],
    canSpawn: [],
    sdkAccess: false,
    teammate: true,
    description: 'Dedicated security audit: injection, XSS, authz/authn, secrets, CVEs, OWASP. Security promoted out of guardian-only.',
    whenToUse: 'Dedicated SECURITY audit (injection/XSS/auth/secrets/CVE/OWASP). Prefer over `guardian` (broad milestone architecture audit) when a card is specifically security-focused, and over `review` when threat-model depth is needed.',
    promptTemplate: 'framework/packs/quality/prompts/security-auditor.md',
    personaTemplate: 'security-reviewer',
    triggerSignals: ['security', 'vulnerability', 'injection', 'xss', 'auth', 'secret', 'cve', 'owasp', 'audit', 'sanitize'],
    taskDepthTiers: {
      small:    { model: 'sonnet', maxCards: 2 },
      standard: { model: 'opus',   maxCards: 4 },
      deep:     { model: 'opus',   maxCards: 4 },
    },
    defaultTraits: ['thorough', 'security'],
    conditionalSpawn: {
      cardSignals: [/security/i, /vulnerab/i, /injection/i, /\bxss\b/i, /\bauth\b/i, /secret/i, /\bcve\b/i, /owasp/i],
      minCards: 1,
    },
    customizationKey: 'security-auditor',
    pack: 'quality',
  },
};

export default AGENT_REGISTRY_DATA;
