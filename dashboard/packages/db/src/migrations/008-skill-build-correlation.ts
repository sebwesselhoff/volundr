import type Database from 'better-sqlite3';

export const version = 8;
export const description = 'Add build failure correlation tracking to skills table';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE skills ADD COLUMN build_failure_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN build_pass_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN last_build_outcome TEXT;

    CREATE TABLE IF NOT EXISTS skill_build_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      project_id TEXT,
      card_id TEXT,
      outcome TEXT NOT NULL,   -- 'pass' | 'fail'
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_build_events_skill ON skill_build_events(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_build_events_outcome ON skill_build_events(outcome);
  `);
}
