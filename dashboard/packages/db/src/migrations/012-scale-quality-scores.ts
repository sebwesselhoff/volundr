import type Database from 'better-sqlite3';

export const version = 12;
export const description = 'Scale existing quality scores from 1-5 to 1-10 range';

export function up(sqlite: Database.Database): void {
  sqlite.exec(`
    UPDATE quality_scores
    SET completeness = completeness * 2,
        code_quality = code_quality * 2,
        format_compliance = format_compliance * 2,
        independence = independence * 2,
        weighted_score = weighted_score * 2,
        updated_at = datetime('now')
    WHERE completeness BETWEEN 1 AND 5;
  `);
}
