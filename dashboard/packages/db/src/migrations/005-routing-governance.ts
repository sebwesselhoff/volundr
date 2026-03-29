import type Database from 'better-sqlite3';

export const version = 5;
export const description = 'Add routing_rules, directives, skills, and reviewer_lockouts tables';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_type TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      examples TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      module_pattern TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS directives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      superseded_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      domain TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      source TEXT NOT NULL DEFAULT 'seed',
      version INTEGER NOT NULL DEFAULT 1,
      validated_at TEXT NOT NULL DEFAULT (date('now')),
      review_by_date TEXT NOT NULL DEFAULT (date('now', '+90 days')),
      triggers TEXT NOT NULL DEFAULT '[]',
      roles TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviewer_lockouts (
      card_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT,
      PRIMARY KEY (card_id, persona_id)
    );

    CREATE INDEX IF NOT EXISTS idx_routing_rules_work_type ON routing_rules(work_type);
    CREATE INDEX IF NOT EXISTS idx_routing_rules_persona ON routing_rules(persona_id);
    CREATE INDEX IF NOT EXISTS idx_directives_project ON directives(project_id);
    CREATE INDEX IF NOT EXISTS idx_directives_status ON directives(status);
    CREATE INDEX IF NOT EXISTS idx_skills_domain ON skills(domain);
    CREATE INDEX IF NOT EXISTS idx_reviewer_lockouts_card ON reviewer_lockouts(card_id);
    CREATE INDEX IF NOT EXISTS idx_reviewer_lockouts_persona ON reviewer_lockouts(persona_id);
  `);
}
