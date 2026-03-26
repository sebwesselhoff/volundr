import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  status: text('status').notNull().default('active'),
  phase: text('phase').notNull().default('discovery'),
  reviewGateLevel: integer('review_gate_level').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const epics = sqliteTable('epics', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  color: text('color').notNull().default('#7b7dbf'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  epicId: text('epic_id').notNull().references(() => epics.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  size: text('size').notNull().default('M'),
  priority: text('priority').notNull().default('P1'),
  status: text('status').notNull().default('backlog'),
  deps: text('deps'),
  criteria: text('criteria'),
  technicalNotes: text('technical_notes'),
  filesCreated: text('files_created'),
  filesModified: text('files_modified'),
  branch: text('branch'),
  isc: text('isc'),  // JSON array: [{ criterion, evidence, passed }]
  assignedPersonaId: text('assigned_persona_id'),
  routingConfidence: text('routing_confidence'),
  routingReason: text('routing_reason'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    parentAgentId: text('parent_agent_id').references((): any => agents.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull().default('running'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    estimatedCost: real('estimated_cost').notNull().default(0),
    startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
    completedAt: text('completed_at'),
    detail: text('detail').notNull().default(''),
  },
  (table) => ({
    motherPerProject: uniqueIndex('idx_volundr_per_project')
      .on(table.projectId)
      .where(sql`type = 'volundr' AND status = 'running'`),
  })
);

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  detail: text('detail'),
  costEstimate: real('cost_estimate'),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
});

export const qualityScores = sqliteTable('quality_scores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: text('card_id').notNull().unique().references(() => cards.id, { onDelete: 'cascade' }),
  completeness: real('completeness'),
  codeQuality: real('code_quality'),
  formatCompliance: real('format_compliance'),
  independence: real('independence'),
  weightedScore: real('weighted_score'),
  implementationType: text('implementation_type'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  cardId: text('card_id'),
  detail: text('detail'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  acknowledgedAt: text('acknowledged_at'),
});

export const hookLogs = sqliteTable('hook_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id'),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  level: text('level').notNull(),
  source: text('source').notNull(),
  event: text('event').notNull(),
  detail: text('detail'),
  agentId: text('agent_id'),
  cardId: text('card_id'),
  error: text('error'),
});

export const lessons = sqliteTable('lessons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  stack: text('stack'),
  source: text('source'),
  isGlobal: integer('is_global', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Journal (project thinking log) ---
export const journal = sqliteTable('journal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull(),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  entry: text('entry').notNull(),
  entryType: text('entry_type').notNull(), // decision, feedback, blocker, insight, discussion, pivot, milestone
  cardId: text('card_id'),
  sessionTag: text('session_tag'),
});

// --- Session Summaries ---
export const sessionSummaries = sqliteTable('session_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull().default(sql`(datetime('now'))`),
  summary: text('summary').notNull(),
  keyDecisions: text('key_decisions'), // JSON array
  blockers: text('blockers'), // JSON array
  nextSteps: text('next_steps'), // JSON array
  developerFeedback: text('developer_feedback'),
  phaseAtStart: text('phase_at_start'),
  phaseAtEnd: text('phase_at_end'),
  cardsCompleted: text('cards_completed'), // JSON array
  cardsStarted: text('cards_started'), // JSON array
});

export { teams, teamMembers, teamMessages, teamTasks } from './team-schema.js';

// --- Skills ---

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(), // kebab-case slug, e.g. "git-workflow-agents"
  name: text('name').notNull(),
  description: text('description').notNull(),
  domain: text('domain').notNull(),
  confidence: text('confidence').notNull().default('medium'), // low | medium | high
  source: text('source').notNull().default('seed'), // seed | earned | extracted | imported
  version: integer('version').notNull().default(1),
  validatedAt: text('validated_at').notNull().default(sql`(date('now'))`),
  reviewByDate: text('review_by_date').notNull(),
  triggers: text('triggers').notNull().default('[]'), // JSON string[]
  roles: text('roles').notNull().default('[]'),       // JSON string[]
  body: text('body').notNull().default(''),           // full markdown body
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Personas ---

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),           // kebab-case: 'fullstack-web'
  name: text('name').notNull(),
  role: text('role').notNull(),           // developer|architect|qa-engineer|etc
  expertise: text('expertise'),           // JSON array
  modelPreference: text('model_preference').default('auto'),
  style: text('style'),
  status: text('status').notNull().default('active'), // active|inactive|retired
  cardsCompleted: integer('cards_completed').notNull().default(0),
  qualityAverage: real('quality_average').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  lastActiveAt: text('last_active_at'),
  charterPath: text('charter_path'),
  historyPath: text('history_path'),
});

export const personaHistoryEntries = sqliteTable('persona_history_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personaId: text('persona_id').notNull().references(() => personas.id),
  projectId: text('project_id'),
  section: text('section').notNull(),    // 'learnings'|'decisions'|'patterns'
  content: text('content').notNull(),
  stackTags: text('stack_tags'),         // JSON array
  confidence: real('confidence').default(1.0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  archivedAt: text('archived_at'),
});

export const personaSkills = sqliteTable('persona_skills', {
  personaId: text('persona_id').notNull().references(() => personas.id),
  skillId: text('skill_id').notNull(),
  confidence: text('confidence').default('low'),
  acquiredAt: text('acquired_at').notNull().default(sql`(datetime('now'))`),
  lastUsedAt: text('last_used_at'),
  usageCount: integer('usage_count').default(0),
  projectId: text('project_id'),
});

export const reviewerLockouts = sqliteTable('reviewer_lockouts', {
  cardId: text('card_id').notNull(),
  personaId: text('persona_id').notNull(),
  lockedAt: text('locked_at').notNull().default(sql`(datetime('now'))`),
  reason: text('reason'),
});
