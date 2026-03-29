import type Database from 'better-sqlite3';

export const version = 7;
export const description = 'Add retirement lifecycle fields to personas table';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE personas ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE personas ADD COLUMN retired_at TEXT;
    ALTER TABLE personas ADD COLUMN alumni_summary TEXT;

    CREATE INDEX IF NOT EXISTS idx_personas_status ON personas(status);
  `);
}
