import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';

interface SeedLesson {
  title: string;
  content: string;
  stack?: string;
  source?: string;
}

/**
 * Seeds community lessons from the framework seed file into the DB.
 * Deduplicates by title — existing lessons with the same title are skipped.
 * Runs once on API startup.
 */
export function seedCommunityLessons(): void {
  // Resolve seed file: VLDR_SEED_PATH env (Docker), or fallback to repo-relative path
  const seedPath = process.env.VLDR_SEED_PATH
    || resolve(import.meta.dirname, '..', '..', '..', '..', 'framework', 'lessons', 'seed.json');

  if (!existsSync(seedPath)) {
    console.log('No community lessons seed file found, skipping.');
    return;
  }

  try {
    const raw = readFileSync(seedPath, 'utf8');
    const seeds: SeedLesson[] = JSON.parse(raw);
    if (!Array.isArray(seeds) || seeds.length === 0) return;

    const db = getDb();

    // Get existing lesson titles for deduplication
    const existing = db.select({ title: schema.lessons.title })
      .from(schema.lessons)
      .where(eq(schema.lessons.isGlobal, true))
      .all();
    const existingTitles = new Set(existing.map(l => l.title));

    let seeded = 0;
    for (const lesson of seeds) {
      if (!lesson.title || !lesson.content) continue;
      if (existingTitles.has(lesson.title)) continue;

      db.insert(schema.lessons).values({
        title: lesson.title,
        content: lesson.content,
        stack: lesson.stack || '',
        source: lesson.source || 'community',
        isGlobal: true,
      }).run();
      seeded++;
    }

    if (seeded > 0) {
      console.log(`Seeded ${seeded} community lessons from ${seedPath}`);
    }
  } catch (err) {
    console.warn('Failed to seed community lessons:', err);
  }
}
