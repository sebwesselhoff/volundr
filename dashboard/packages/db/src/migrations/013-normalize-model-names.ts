import type Database from 'better-sqlite3';

export const version = 13;
export const description = 'Normalize agent model names to canonical keys (opus-4, sonnet-4, haiku-4)';

export function up(sqlite: Database.Database): void {
  // Map all known variants to canonical names
  const mappings: [string, string][] = [
    ['claude-opus-4-6', 'opus-4'],
    ['claude-opus-4-5', 'opus-4'],
    ['opus', 'opus-4'],
    ['claude-sonnet-4-6', 'sonnet-4'],
    ['claude-sonnet-4-5', 'sonnet-4'],
    ['sonnet', 'sonnet-4'],
    ['claude-haiku-4-5', 'haiku-4'],
    ['claude-haiku-3-5', 'haiku-4'],
    ['haiku', 'haiku-4'],
  ];

  const stmt = sqlite.prepare('UPDATE agents SET model = ? WHERE model = ?');
  for (const [from, to] of mappings) {
    stmt.run(to, from);
  }
}
