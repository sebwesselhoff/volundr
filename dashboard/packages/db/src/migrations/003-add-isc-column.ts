import type Database from 'better-sqlite3';

export const version = 3;
export const description = 'Add isc column to cards (JSON array: [{ criterion, evidence, passed }])';

export function up(sqlite: Database.Database): void {
  const cols = sqlite.prepare('PRAGMA table_info(cards)').all().map((r: any) => r.name as string);
  if (!cols.includes('isc')) {
    sqlite.exec('ALTER TABLE cards ADD COLUMN isc TEXT');
  }
}
