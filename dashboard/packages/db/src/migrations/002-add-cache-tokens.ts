import type Database from 'better-sqlite3';

export const version = 2;
export const description = 'Add cache_creation_tokens and cache_read_tokens columns to agents';

export function up(sqlite: Database.Database): void {
  const cols = sqlite.prepare('PRAGMA table_info(agents)').all().map((r: any) => r.name as string);
  if (!cols.includes('cache_creation_tokens')) {
    sqlite.exec('ALTER TABLE agents ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('cache_read_tokens')) {
    sqlite.exec('ALTER TABLE agents ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0');
  }
}
