import type {
  ProjectStatus, ProjectPhase, CardStatus, CardSize, CardPriority,
  AgentType, AgentStatus, EventType, ImplementationType, JournalEntryType,
  TeamStatus, TeamMemberStatus, TeamTaskStatus,
  PersonaStatus, PersonaRole, HistorySection,
} from './enums.js';

// --- Entity types (match DB schema / API responses exactly) ---

export interface Project {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  reviewGateLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface Epic {
  id: string;
  projectId: string;
  name: string;
  domain: string;
  color: string;
  sortOrder: number;
}

export interface Card {
  id: string;
  epicId: string;
  projectId: string;
  title: string;
  description: string;
  size: CardSize;
  priority: CardPriority;
  status: CardStatus;
  deps: string[];
  criteria: string;
  technicalNotes: string;
  filesCreated: string[];
  filesModified: string[];
  branch: string;
  isc: Array<{ criterion: string; evidence: string | null; passed: boolean | null }> | null;
  assignedPersonaId: string | null;
  routingConfidence: string | null;
  routingReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Agent {
  id: string;
  projectId: string;
  cardId: string | null;
  parentAgentId: string | null;
  type: AgentType;
  model: string;
  status: AgentStatus;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCost: number;
  startedAt: string;
  completedAt: string | null;
  detail: string;
}

export interface Event {
  id: number;
  projectId: string;
  cardId: string | null;
  agentId: string | null;
  type: EventType;
  detail: string;
  costEstimate: number | null;
  timestamp: string;
}

export interface QualityScore {
  id: number;
  cardId: string;
  completeness: number;
  codeQuality: number;
  formatCompliance: number;
  independence: number;
  weightedScore: number;
  implementationType: ImplementationType;
  createdAt: string;
  updatedAt: string;
}

export interface Lesson {
  id: number;
  projectId: string | null;
  title: string;
  content: string;
  stack: string;
  source: string;
  isGlobal: boolean;
  createdAt: string;
}

// --- API input types ---

export interface CreateProjectInput {
  id: string;
  name: string;
  path: string;
  status?: ProjectStatus;
  phase?: ProjectPhase;
  reviewGateLevel?: number;
}

export interface UpdateProjectInput {
  name?: string;
  status?: ProjectStatus;
  phase?: ProjectPhase;
  reviewGateLevel?: number;
}

export interface CreateEpicInput {
  name: string;
  domain: string;
  color: string;
  sortOrder?: number;
}

export interface UpdateEpicInput {
  name?: string;
  domain?: string;
  color?: string;
  sortOrder?: number;
}

export interface CreateCardInput {
  id: string;
  epicId: string;
  title: string;
  description?: string;
  size: CardSize;
  priority: CardPriority;
  deps?: string[];
  criteria?: string;
  technicalNotes?: string;
}

export interface UpdateCardInput {
  status?: CardStatus;
  branch?: string;
  filesCreated?: string[];
  filesModified?: string[];
  priority?: CardPriority;
  completedAt?: string;
  deps?: string[];
}

export interface SpawnAgentInput {
  projectId: string;
  type: AgentType;
  model: string;
  cardId?: string;
  parentAgentId?: string;
  detail?: string;
}

export interface UpdateAgentInput {
  status?: AgentStatus;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  detail?: string;
  completedAt?: string;
}

export interface LogEventInput {
  projectId: string;
  type: EventType;
  cardId?: string;
  agentId?: string;
  detail: string;
  costEstimate?: number;
}

export interface ScoreQualityInput {
  cardId: string;
  completeness: number;
  codeQuality: number;
  formatCompliance: number;
  independence: number;
  implementationType: ImplementationType;
}

export interface CreateLessonInput {
  projectId?: string;
  title: string;
  content: string;
  stack: string;
  source?: string;
  isGlobal?: boolean;
}

// --- Metrics ---

export interface MetricsResponse {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  tokensByModel: Record<string, { prompt: number; completion: number; cacheCreation: number; cacheRead: number }>;
  tokensOverTime: Array<{ timestamp: string; prompt: number; completion: number; cacheCreation: number; cacheRead: number }>;
  totalEstimatedCost: number;
  costByEpic: Record<string, number>;
  costByModel: Record<string, number>;
  averageQualityScore: number;
  qualityTrend: Array<{ cardId: string; score: number; timestamp: string }>;
  cardsCompletedPerHour: number;
  cardsByStatus: Record<string, number>;
  activeAgents: number;
  totalAgentsSpawned: number;
  agentsByType: Record<string, number>;
  agentsByModel: Record<string, number>;
  retryCount: number;
  retryRate: number;
  timeRange: { from: string; to: string };
}

// --- Log Entry ---

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: number;
  projectId: string | null;
  timestamp: string;
  level: LogLevel;
  source: string;
  event: string;
  detail: string | null;
  agentId: string | null;
  cardId: string | null;
  error: string | null;
}

export interface CreateLogInput {
  projectId?: string;
  level: LogLevel;
  source: string;
  event: string;
  detail?: string;
  agentId?: string;
  cardId?: string;
  error?: string;
}

// --- Journal ---

export interface JournalEntry {
  id: number;
  projectId: string;
  timestamp: string;
  entry: string;
  entryType: JournalEntryType;
  cardId: string | null;
  sessionTag: string | null;
}

export interface CreateJournalInput {
  projectId: string;
  entry: string;
  entryType: JournalEntryType;
  cardId?: string;
  sessionTag?: string;
}

// --- Session Summaries ---

export interface SessionSummary {
  id: number;
  projectId: string;
  startedAt: string;
  endedAt: string;
  summary: string;
  keyDecisions: string | null;
  blockers: string | null;
  nextSteps: string | null;
  developerFeedback: string | null;
  phaseAtStart: string | null;
  phaseAtEnd: string | null;
  cardsCompleted: string | null;
  cardsStarted: string | null;
}

export interface CreateSessionSummaryInput {
  projectId: string;
  startedAt: string;
  summary: string;
  keyDecisions?: string;
  blockers?: string;
  nextSteps?: string;
  developerFeedback?: string;
  phaseAtStart?: string;
  phaseAtEnd?: string;
  cardsCompleted?: string;
  cardsStarted?: string;
}

// --- Personas ---

export interface Persona {
  id: string;
  name: string;
  role: PersonaRole;
  expertise: string | null;   // JSON array string
  modelPreference: string | null;
  style: string | null;
  status: PersonaStatus;
  cardsCompleted: number;
  qualityAverage: number;
  totalTokens: number;
  totalCost: number;
  createdAt: string;
  lastActiveAt: string | null;
  charterPath: string | null;
  historyPath: string | null;
}

export interface PersonaHistoryEntry {
  id: number;
  personaId: string;
  projectId: string | null;
  section: HistorySection;
  content: string;
  stackTags: string | null;   // JSON array string
  confidence: number | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface PersonaSkill {
  personaId: string;
  skillId: string;
  confidence: string | null;
  acquiredAt: string;
  lastUsedAt: string | null;
  usageCount: number | null;
  projectId: string | null;
}

export interface ReviewerLockout {
  cardId: string;
  personaId: string;
  lockedAt: string;
  reason: string | null;
}

export interface CreatePersonaInput {
  id: string;
  name: string;
  role: PersonaRole;
  expertise?: string[];
  style?: string;
  modelPreference?: string;
  status?: PersonaStatus;
  charterPath?: string;
  historyPath?: string;
}

export interface UpdatePersonaInput {
  name?: string;
  role?: PersonaRole;
  expertise?: string[];
  style?: string;
  modelPreference?: string;
  status?: PersonaStatus;
  cardsCompleted?: number;
  qualityAverage?: number;
  totalTokens?: number;
  totalCost?: number;
  lastActiveAt?: string;
  charterPath?: string;
  historyPath?: string;
}

export interface CreatePersonaHistoryEntryInput {
  projectId?: string;
  section: HistorySection;
  content: string;
  stackTags?: string[];
  confidence?: number;
}

// --- Health ---

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  dbConnected: boolean;
  wsClients: number;
}

// --- Hierarchy ---

export type HierarchyLevel = 'flat' | 'two';

export interface HierarchyConfigResponse {
  level: HierarchyLevel;
  reason: string;
  forceLevel?: HierarchyLevel;
  budgetCeiling: number | null;
  budgetWarning: boolean;
  activeTeammates: number;
  maxTeammates: number;
  activeSubagents: number;
  maxConcurrentAgents: number;
  recommendedDevelopers: number;
  conditionalTeammates: string[];
}

export interface AgentHierarchyNode {
  agent: Agent;
  children: AgentHierarchyNode[];
  domainColor?: string;
  domainName?: string;
  subtreeCost: number;
  subtreeTokens: { prompt: number; completion: number; cacheCreation: number; cacheRead: number };
  subtreeAgentCount: number;
}

// --- Agent Teams ---

export interface Team {
  id: string;
  name: string;
  description: string | null;
  leadAgentId: string;
  leadSessionId: string | null;
  status: TeamStatus;
  createdAt: string;
  endedAt: string | null;
}

export interface TeamMember {
  id: string;
  teamId: string;
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  status: TeamMemberStatus;
  joinedAt: string;
  leftAt: string | null;
  cwd: string | null;
}

export interface TeamMessage {
  id: number;
  teamId: string;
  fromAgent: string;
  toAgent: string | null;
  text: string;
  summary: string | null;
  timestamp: string;
  read: boolean;
}

export interface TeamTask {
  id: number;
  teamId: string;
  taskId: string;
  subject: string;
  description: string | null;
  status: TeamTaskStatus;
  owner: string | null;
  blocks: string[];
  blockedBy: string[];
  claimedAt: string | null;
  completedAt: string | null;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
}

export type DisplayMessage =
  | { kind: 'chat'; data: TeamMessage }
  | { kind: 'system'; event: string; detail: string; timestamp: string; teamId: string };

// --- Skills ---

export interface Skill {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  version: number;
  validatedAt: string;
  reviewByDate: string;
  triggers: string[];
  roles: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence?: 'low' | 'medium' | 'high';
  source?: string;
  version?: number;
  validatedAt?: string;
  reviewByDate?: string;
  triggers?: string[];
  roles?: string[];
  body?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  domain?: string;
  confidence?: 'low' | 'medium' | 'high';
  version?: number;
  validatedAt?: string;
  reviewByDate?: string;
  triggers?: string[];
  roles?: string[];
  body?: string;
}

export interface SkillMatchResult {
  skill: Skill;
  score: number;
  matchedTriggers: string[];
}
