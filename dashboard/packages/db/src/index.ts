import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { runMigrations, getCurrentSchemaVersion } from './migrate.js';

// Always store DB in dashboard/data/ regardless of cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', '..', 'data');
const DB_PATH = process.env.VLDR_DB_PATH || resolve(DATA_DIR, 'the-forge.db');

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database.Database | null = null;

export async function initDb(): Promise<ReturnType<typeof drizzle>> {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  await runMigrations(sqlite, DB_PATH);

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function getRawSqlite(): Database.Database {
  if (!_sqlite) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _sqlite;
}

export function getSchemaVersion(): number {
  if (!_sqlite) return 0;
  return getCurrentSchemaVersion(_sqlite);
}

export { schema };
export type Db = ReturnType<typeof drizzle>;
