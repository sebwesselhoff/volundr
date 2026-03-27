import type Database from 'better-sqlite3';

export const version = 13;
export const description = 'Add composite index on events(project_id, timestamp) for timeline queries';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_project_ts
    ON events(project_id, timestamp DESC);
  `);
}
