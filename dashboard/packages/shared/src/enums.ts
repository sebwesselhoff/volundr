export const ProjectStatus = {
  active: 'active',
  completed: 'completed',
  paused: 'paused',
  archived: 'archived',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const ProjectPhase = {
  discovery: 'discovery',
  blueprint: 'blueprint',
  breakdown: 'breakdown',
  implementation: 'implementation',
  testing: 'testing',
  integration: 'integration',
  completed: 'completed',
} as const;
export type ProjectPhase = (typeof ProjectPhase)[keyof typeof ProjectPhase];

export const CardStatus = {
  backlog: 'backlog',
  in_progress: 'in_progress',
  review: 'review',
  testing: 'testing',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
} as const;
export type CardStatus = (typeof CardStatus)[keyof typeof CardStatus];

export const CardSize = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
} as const;
export type CardSize = (typeof CardSize)[keyof typeof CardSize];

export const CardPriority = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
} as const;
export type CardPriority = (typeof CardPriority)[keyof typeof CardPriority];

export const AgentType = {
  volundr: 'volundr',
  orchestrator: 'orchestrator',
  developer: 'developer',
  architect: 'architect',
  'qa-engineer': 'qa-engineer',
  'devops-engineer': 'devops-engineer',
  designer: 'designer',
  'roundtable-voice': 'roundtable-voice',
  'chaos-engine-voice': 'chaos-engine-voice',
  tester: 'tester',
  content: 'content',
  review: 'review',
  fixer: 'fixer',
  planner: 'planner',
  guardian: 'guardian',
  researcher: 'researcher',
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

export const AgentStatus = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const EventType = {
  agent_spawned: 'agent_spawned',
  agent_completed: 'agent_completed',
  agent_timeout: 'agent_timeout',
  card_status_changed: 'card_status_changed',
  quality_scored: 'quality_scored',
  retry_triggered: 'retry_triggered',
  branch_merged: 'branch_merged',
  optimization_cycle: 'optimization_cycle',
  milestone_reached: 'milestone_reached',
  intervention: 'intervention',
  checkpoint_created: 'checkpoint_created',
  error: 'error',
  build_gate_failed: 'build_gate_failed',
  build_gate_passed: 'build_gate_passed',
  antipattern_found: 'antipattern_found',
  state_saved: 'state_saved',
  command_received: 'command_received',
  command_acknowledged: 'command_acknowledged',
  hierarchy_assessed: 'hierarchy_assessed',
  session_started: 'session_started',
  session_ended: 'session_ended',
  shutdown_started: 'shutdown_started',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const ImplementationType = {
  agent: 'agent',
  direct: 'direct',
} as const;
export type ImplementationType = (typeof ImplementationType)[keyof typeof ImplementationType];

export const ReviewType = {
  self: 'self',
  reviewer: 'reviewer',
  human: 'human',
} as const;
export type ReviewType = (typeof ReviewType)[keyof typeof ReviewType];

export const JournalEntryType = {
  decision: 'decision',
  feedback: 'feedback',
  blocker: 'blocker',
  insight: 'insight',
  discussion: 'discussion',
  pivot: 'pivot',
  milestone: 'milestone',
} as const;
export type JournalEntryType = (typeof JournalEntryType)[keyof typeof JournalEntryType];

// --- Agent Teams ---

export const TeamStatus = { active: 'active', ended: 'ended' } as const;
export type TeamStatus = (typeof TeamStatus)[keyof typeof TeamStatus];

export const TeamMemberStatus = { active: 'active', idle: 'idle', stopped: 'stopped' } as const;
export type TeamMemberStatus = (typeof TeamMemberStatus)[keyof typeof TeamMemberStatus];

export const TeamTaskStatus = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' } as const;
export type TeamTaskStatus = (typeof TeamTaskStatus)[keyof typeof TeamTaskStatus];

// --- Personas ---

export const PersonaStatus = {
  active: 'active',
  inactive: 'inactive',
  retired: 'retired',
} as const;
export type PersonaStatus = (typeof PersonaStatus)[keyof typeof PersonaStatus];

export const PersonaRole = {
  developer: 'developer',
  architect: 'architect',
  'qa-engineer': 'qa-engineer',
  'devops-engineer': 'devops-engineer',
  designer: 'designer',
  reviewer: 'reviewer',
  guardian: 'guardian',
  researcher: 'researcher',
  content: 'content',
} as const;
export type PersonaRole = (typeof PersonaRole)[keyof typeof PersonaRole];

export const HistorySection = {
  learnings: 'learnings',
  decisions: 'decisions',
  patterns: 'patterns',
} as const;
export type HistorySection = (typeof HistorySection)[keyof typeof HistorySection];

// --- Sprint 2 additions ---

export const RoutingConfidence = { low: 'low', medium: 'medium', high: 'high' } as const;
export type RoutingConfidence = (typeof RoutingConfidence)[keyof typeof RoutingConfidence];

export const DirectiveSource = { confirmed: 'confirmed', manual: 'manual', imported: 'imported' } as const;
export type DirectiveSource = (typeof DirectiveSource)[keyof typeof DirectiveSource];

export const DirectiveStatus = { active: 'active', suppressed: 'suppressed', superseded: 'superseded' } as const;
export type DirectiveStatus = (typeof DirectiveStatus)[keyof typeof DirectiveStatus];
