import type Database from 'better-sqlite3';

export const version = 11;
export const description = 'Create persona_skills table for per-persona skill usage tracking';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS persona_skills (
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (persona_id, skill_id)
    );

    CREATE INDEX IF NOT EXISTS idx_persona_skills_persona ON persona_skills(persona_id);
    CREATE INDEX IF NOT EXISTS idx_persona_skills_skill ON persona_skills(skill_id);
  `);
}
