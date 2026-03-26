import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { projects } from './schema.js';

// --- Routing Rules (RT-001) ---

export const routingRules = sqliteTable('routing_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workType: text('work_type').notNull(),
  personaId: text('persona_id').notNull(),
  examples: text('examples'),                          // JSON string[]
  confidence: text('confidence').notNull().default('medium'), // low|medium|high
  modulePattern: text('module_pattern'),               // path glob pattern
  priority: integer('priority').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Directives (GV-001) ---

export const directives = sqliteTable('directives', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  source: text('source').notNull(),                    // confirmed|manual|imported
  status: text('status').notNull().default('active'),  // active|suppressed|superseded
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at'),
  supersededBy: integer('superseded_by'),
});

// --- Skills (SK-001) ---

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),                         // kebab-case slug
  name: text('name').notNull(),
  description: text('description').notNull(),
  domain: text('domain').notNull(),
  confidence: text('confidence').notNull().default('medium'), // low|medium|high
  source: text('source').notNull().default('seed'),    // seed|earned|extracted|imported
  version: integer('version').notNull().default(1),
  validatedAt: text('validated_at').notNull().default(sql`(date('now'))`),
  reviewByDate: text('review_by_date').notNull().default(sql`(date('now', '+90 days'))`),
  triggers: text('triggers').notNull().default('[]'),  // JSON string[]
  roles: text('roles').notNull().default('[]'),        // JSON string[]
  body: text('body').notNull().default(''),
  acquiredAt: text('acquired_at').notNull().default(sql`(datetime('now'))`),
  lastUsedAt: text('last_used_at'),
  usageCount: integer('usage_count').notNull().default(0),
  buildFailureCount: integer('build_failure_count').notNull().default(0),
  buildPassCount: integer('build_pass_count').notNull().default(0),
  lastBuildOutcome: text('last_build_outcome'),         // 'pass' | 'fail' | null
  projectId: text('project_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Skill Build Events (SK-007) ---

export const skillBuildEvents = sqliteTable('skill_build_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  projectId: text('project_id'),
  cardId: text('card_id'),
  outcome: text('outcome').notNull(), // 'pass' | 'fail'
  detail: text('detail'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Reviewer Lockouts (GV-004) ---

export const reviewerLockouts = sqliteTable(
  'reviewer_lockouts',
  {
    cardId: text('card_id').notNull(),
    personaId: text('persona_id').notNull(),
    lockedAt: text('locked_at').notNull().default(sql`(datetime('now'))`),
    reason: text('reason'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.cardId, table.personaId] }),
  }),
);
