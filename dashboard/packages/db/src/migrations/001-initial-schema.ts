import type Database from 'better-sqlite3';

export const version = 1;
export const description = 'Initial schema: projects, epics, cards, agents, events, quality_scores, commands, lessons, journal, session_summaries, hook_logs';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', phase TEXT NOT NULL DEFAULT 'discovery',
      review_gate_level INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, domain TEXT NOT NULL, color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', size TEXT NOT NULL,
      priority TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'backlog',
      deps TEXT NOT NULL DEFAULT '[]', criteria TEXT NOT NULL DEFAULT '',
      technical_notes TEXT NOT NULL DEFAULT '', files_created TEXT NOT NULL DEFAULT '[]',
      files_modified TEXT NOT NULL DEFAULT '[]', branch TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      type TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT,
      detail TEXT NOT NULL DEFAULT ''
    );
    DROP INDEX IF EXISTS idx_volundr_per_project;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_volundr_per_project ON agents(project_id) WHERE type = 'volundr' AND status = 'running';
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT, agent_id TEXT, type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', cost_estimate REAL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
      completeness INTEGER NOT NULL, code_quality INTEGER NOT NULL,
      format_compliance INTEGER NOT NULL, independence INTEGER NOT NULL,
      weighted_score REAL NOT NULL, implementation_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      card_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      agent_id TEXT,
      card_id TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content TEXT NOT NULL,
      stack TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      is_global INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      entry TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      card_id TEXT,
      session_tag TEXT
    );
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT (datetime('now')),
      summary TEXT NOT NULL,
      key_decisions TEXT,
      blockers TEXT,
      next_steps TEXT,
      developer_feedback TEXT,
      phase_at_start TEXT,
      phase_at_end TEXT,
      cards_completed TEXT,
      cards_started TEXT
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      lead_agent_id TEXT NOT NULL,
      lead_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT NOT NULL,
      left_at TEXT,
      cwd TEXT
    );
    CREATE TABLE IF NOT EXISTS team_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      text TEXT NOT NULL,
      summary TEXT,
      timestamp TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_messages_dedup ON team_messages(team_id, content_hash);
    CREATE TABLE IF NOT EXISTS team_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT,
      blocks TEXT,
      blocked_by TEXT,
      claimed_at TEXT,
      completed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_tasks_dedup ON team_tasks(team_id, task_id);
  `);
}
