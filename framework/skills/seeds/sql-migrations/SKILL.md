---
name: "SQL Migrations"
description: "Migration versioning, idempotent DDL, rollback strategies, and zero-downtime schema changes"
domain: "database"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "migration"
  - "schema change"
  - "alter table"
  - "ddl"
  - "database migration"
  - "rollback"
  - "zero downtime"
roles:
  - "developer"
  - "devops-engineer"
  - "architect"
---

## Context
Apply when changing the database schema — adding tables, columns, indexes, or altering constraints.
Migrations must be versioned, idempotent, and safe to run on live data.

## Patterns

**Version migrations sequentially:** `001-init.ts`, `002-add-epics.ts`, `003-add-cards.ts`.
The runner applies them in order; never skip a number.

**`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:**
```sql
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
-- Idempotent column add (SQLite uses try/catch; Postgres supports IF NOT EXISTS)
ALTER TABLE skills ADD COLUMN domain TEXT NOT NULL DEFAULT '';
```

**SQLite idempotent column migrations** — SQLite does not support `ADD COLUMN IF NOT EXISTS`;
wrap in try/catch:
```typescript
try { sqlite.exec('ALTER TABLE skills ADD COLUMN file_path TEXT'); } catch {}
```

**Zero-downtime column adds:**
1. Add column as nullable (no default needed by existing rows)
2. Backfill data in batches
3. Add NOT NULL constraint in a later migration after backfill

**Never drop columns in production migrations** — mark deprecated with a comment, drop in a
coordinated maintenance window.

**Test migrations on a copy of production data** before deploying.

## Examples

```typescript
// Migration module pattern (Volundr style)
export const version = 5;
export function up(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'medium',
      source TEXT NOT NULL DEFAULT 'seed',
      version INTEGER NOT NULL DEFAULT 1,
      triggers TEXT NOT NULL DEFAULT '[]',
      roles TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
```

## Anti-Patterns

- **Editing existing migration files** — once applied, a migration is immutable; add a new one
- **Renaming columns in place** — breaks existing queries; add new column + copy + deprecate old
- **Running raw DDL without a migration system** — no audit trail, impossible to replay
- **`DROP COLUMN` without a rollback plan** — data loss with no undo
- **Long-running migrations in a transaction** — can lock tables for minutes; migrate in batches
