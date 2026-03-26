import type Database from 'better-sqlite3';
import { existsSync, readdirSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MigrationModule {
  version: number;
  description: string;
  up: (sqlite: Database.Database) => void;
}

function bootstrapSchemaVersion(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    )
  `);
}

function getCurrentVersion(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  return row?.v ?? 0;
}

const LEGACY_STAMP_VERSION = 3;

function isExistingDb(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    .get();
  return row != null;
}

function stampVersion(sqlite: Database.Database, version: number, description: string): void {
  sqlite
    .prepare('INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?)')
    .run(version, description);
}

export async function runMigrations(sqlite: Database.Database, dbPath: string): Promise<void> {
  bootstrapSchemaVersion(sqlite);

  let current = getCurrentVersion(sqlite);

  // Existing DB that predates the migration runner: all inline migrations already applied.
  // Stamp at LEGACY_STAMP_VERSION so we don't re-run them.
  if (current === 0 && isExistingDb(sqlite)) {
    stampVersion(sqlite, LEGACY_STAMP_VERSION, 'Legacy DB stamped at v3 (inline migrations already applied)');
    current = LEGACY_STAMP_VERSION;
  }

  const migrationsDir = resolve(__dirname, 'migrations');
  if (!existsSync(migrationsDir)) {
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  for (const file of files) {
    const versionNum = parseInt(file.split('-')[0], 10);
    if (isNaN(versionNum) || versionNum <= current) continue;

    // Backup DB before applying migration
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, `${dbPath}.backup-v${current}`);
    }

    const mod = (await import(pathToFileURL(join(migrationsDir, file)).href)) as MigrationModule;
    mod.up(sqlite);

    sqlite
      .prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)')
      .run(versionNum, mod.description ?? file);

    current = versionNum;
  }
}

export function getCurrentSchemaVersion(sqlite: Database.Database): number {
  try {
    bootstrapSchemaVersion(sqlite);
    return getCurrentVersion(sqlite);
  } catch {
    return 0;
  }
}
