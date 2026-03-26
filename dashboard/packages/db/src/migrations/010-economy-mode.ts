import type Database from 'better-sqlite3';

export const version = 10;
export const description = 'Add economy_mode column to projects table';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE projects ADD COLUMN economy_mode INTEGER NOT NULL DEFAULT 0;
  `);
}
