import type Database from 'better-sqlite3';

export const version = 4;
export const description = 'Add personas, persona_history, and persona_stats tables';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      expertise TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT '',
      model_preference TEXT NOT NULL DEFAULT 'auto',
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS persona_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      card_id TEXT,
      stack_tags TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_persona_history_persona
      ON persona_history(persona_id);
    CREATE INDEX IF NOT EXISTS idx_persona_history_archived
      ON persona_history(persona_id, archived);

    CREATE TABLE IF NOT EXISTS persona_stats (
      persona_id TEXT PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
      projects_count INTEGER NOT NULL DEFAULT 0,
      cards_count INTEGER NOT NULL DEFAULT 0,
      quality_avg REAL,
      last_active_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
