import type Database from 'better-sqlite3';

export const version = 18;
export const description =
  "Add agents.session_id — stores the mother Volundr's CC session_id on its agent row so a " +
  'spawned subagent resolves its parent by matching input.session_id (concurrent-session-safe, ' +
  'no tmpdir map / boot step required). FRW-BL-068.';

// Auto-discovered by migrate.ts (numbered filename + exported up()/version/description); no
// manual registration step. Idempotent ALTER guarded by columnExists — matches sibling
// migration 017's pattern so a partial/prior run is safe to re-apply.
//
// REQUIRED COMPANION CHANGE: the mother-Volundr registration POST /api/agents must now send
// `sessionId` (see .claude/hooks/session-start.js — the volundr agent POST) and the API route
// must accept it (dashboard/packages/api/src/routes/agents.ts). This column is the persistence
// target for that value. Existing volundr rows keep session_id = NULL (back-compat); agent-start
// then falls back to the tmpdir session-<id> file / single-volundr heuristic, exactly as before.
//
// Live verification is post-rebuild only (migrations run on the dashboard image, not in the card
// worktree): on next `runMigrations`, PRAGMA table_info(agents) should list `session_id`.
function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export function up(sqlite: Database.Database): void {
  // Idempotent — skip if a prior partial run already added the column.
  if (!columnExists(sqlite, 'agents', 'session_id')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN session_id TEXT;`);
  }
}
