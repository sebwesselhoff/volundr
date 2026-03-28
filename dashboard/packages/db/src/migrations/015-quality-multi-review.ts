import type Database from 'better-sqlite3';

export const version = 15;
export const description = 'Allow multiple quality scores per card (self + reviewer) — replace UNIQUE(card_id) with UNIQUE(card_id, review_type)';

export function up(sqlite: Database.Database): void {
  // SQLite cannot ALTER a UNIQUE constraint directly.
  // Recreate the table with the new constraint.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quality_scores_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      completeness REAL,
      code_quality REAL,
      format_compliance REAL,
      correctness REAL,
      weighted_score REAL,
      implementation_type TEXT,
      review_type TEXT DEFAULT 'self',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(card_id, review_type)
    );

    INSERT INTO quality_scores_new
      (id, card_id, completeness, code_quality, format_compliance, correctness,
       weighted_score, implementation_type, review_type, created_at, updated_at)
    SELECT id, card_id, completeness, code_quality, format_compliance, correctness,
           weighted_score, implementation_type, COALESCE(review_type, 'self'), created_at, updated_at
    FROM quality_scores;

    DROP TABLE quality_scores;
    ALTER TABLE quality_scores_new RENAME TO quality_scores;
  `);
}
