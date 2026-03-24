import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  leadAgentId: text('lead_agent_id').notNull(),
  leadSessionId: text('lead_session_id'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  endedAt: text('ended_at'),
}, (table) => ({
  uniqueName: uniqueIndex('idx_teams_name').on(table.name),
}));

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  agentType: text('agent_type').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull().default('active'),
  joinedAt: text('joined_at').notNull(),
  leftAt: text('left_at'),
  cwd: text('cwd'),
});

export const teamMessages = sqliteTable('team_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent'),
  text: text('text').notNull(),
  summary: text('summary'),
  timestamp: text('timestamp').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  contentHash: text('content_hash').notNull(),
}, (table) => ({
  uniqueMessage: uniqueIndex('idx_team_messages_dedup').on(table.teamId, table.contentHash),
}));

export const teamTasks = sqliteTable('team_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull(),
  subject: text('subject').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  owner: text('owner'),
  blocks: text('blocks'),
  blockedBy: text('blocked_by'),
  claimedAt: text('claimed_at'),
  completedAt: text('completed_at'),
}, (table) => ({
  uniqueTask: uniqueIndex('idx_team_tasks_dedup').on(table.teamId, table.taskId),
}));
