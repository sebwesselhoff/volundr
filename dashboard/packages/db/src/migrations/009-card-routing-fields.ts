import type Database from 'better-sqlite3';

export const version = 9;
export const description = 'Add routing fields to cards table (assigned_persona_id, routing_confidence, routing_reason)';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE cards ADD COLUMN assigned_persona_id TEXT;
    ALTER TABLE cards ADD COLUMN routing_confidence TEXT;
    ALTER TABLE cards ADD COLUMN routing_reason TEXT;
  `);
}
