import type Database from 'better-sqlite3';

export const version = 14;
export const description = 'Rename independence to correctness, add review_type column to quality_scores';

export function up(sqlite: Database.Database): void {
  // Add correctness column (replaces independence conceptually, but keep old column for data)
  sqlite.exec(`ALTER TABLE quality_scores ADD COLUMN correctness REAL;`);

  // Copy independence values into correctness for existing rows
  sqlite.exec(`UPDATE quality_scores SET correctness = independence WHERE correctness IS NULL;`);

  // Add review_type column (self | reviewer | human)
  sqlite.exec(`ALTER TABLE quality_scores ADD COLUMN review_type TEXT DEFAULT 'self';`);
}
