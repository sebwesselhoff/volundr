import type Database from 'better-sqlite3';

export const version = 16;
export const description = 'Add source column to persona_history — tracks whether a row was written organically (hook/API) or synthesised on card close';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    ALTER TABLE persona_history ADD COLUMN source TEXT NOT NULL DEFAULT 'organic';
  `);
}
