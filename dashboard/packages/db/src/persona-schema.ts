import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Personas ---

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),                    // e.g. "fullstack-web"
  name: text('name').notNull(),                   // display name e.g. "Alex Chen"
  role: text('role').notNull(),                   // developer | architect | qa-engineer | etc.
  expertise: text('expertise').notNull(),         // comma-separated domains
  style: text('style').notNull().default(''),
  modelPreference: text('model_preference').notNull().default('auto'),
  source: text('source').notNull().default('seed'), // seed | user
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// Shadow history — one row per learning/decision/pattern entry.
// Mirrors history.md but stored in DB for querying, decay, and archival.
export const personaHistory = sqliteTable('persona_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  entryType: text('entry_type').notNull(), // learning | decision | pattern | core_context
  content: text('content').notNull(),
  projectId: text('project_id'),           // nullable — cross-project patterns have no project
  projectName: text('project_name'),       // stored at write time (project may be deleted)
  cardId: text('card_id'),
  stackTags: text('stack_tags'),           // JSON string[] e.g. '["nextjs","sqlite"]'
  // Confidence decay: starts at 1.0, decays toward 0 as time passes without reinforcement.
  // Entries below ARCHIVE_THRESHOLD are moved to archived=1.
  confidence: real('confidence').notNull().default(1.0),
  lastReinforcedAt: text('last_reinforced_at').notNull().default(sql`(datetime('now'))`),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// Aggregate stats per persona — updated after each card completion.
export const personaStats = sqliteTable(
  'persona_stats',
  {
    personaId: text('persona_id').primaryKey().references(() => personas.id, { onDelete: 'cascade' }),
    projectsCount: integer('projects_count').notNull().default(0),
    cardsCount: integer('cards_count').notNull().default(0),
    qualityAvg: real('quality_avg'),
    lastActiveAt: text('last_active_at'),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
);
