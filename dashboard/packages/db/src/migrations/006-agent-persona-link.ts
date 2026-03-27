import type Database from 'better-sqlite3';

export const version = 6;
export const description = 'Add persona_id to agents table for spawn-time persona linking';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE agents ADD COLUMN persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_agents_persona ON agents(persona_id);
  `);
}
