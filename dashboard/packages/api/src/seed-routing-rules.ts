import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getDb, schema } from '@vldr/db';

interface SeedRoutingRule {
  workType: string;
  personaId: string;
  examples?: string[];
  confidence?: string;
  modulePattern?: string;
  priority?: number;
}

/**
 * Seeds routing rules from the framework seed file into the DB.
 * Deduplicates by workType — existing rules with the same workType are skipped.
 * Runs once on API startup.
 */
export function seedRoutingRules(): void {
  const seedPath = process.env.VLDR_ROUTING_SEED_PATH
    || resolve(import.meta.dirname, '..', '..', '..', '..', 'framework', 'routing-rules', 'seed.json');

  if (!existsSync(seedPath)) {
    console.log('No routing rules seed file found, skipping.');
    return;
  }

  try {
    const raw = readFileSync(seedPath, 'utf8');
    const seeds: SeedRoutingRule[] = JSON.parse(raw);
    if (!Array.isArray(seeds) || seeds.length === 0) return;

    const db = getDb();

    // Get existing workTypes for deduplication
    const existing = db.select({ workType: schema.routingRules.workType })
      .from(schema.routingRules)
      .all();
    const existingTypes = new Set(existing.map(r => r.workType));

    let seeded = 0;
    for (const rule of seeds) {
      if (!rule.workType || !rule.personaId) continue;
      if (existingTypes.has(rule.workType)) continue;

      db.insert(schema.routingRules).values({
        workType: rule.workType,
        personaId: rule.personaId,
        examples: rule.examples ? JSON.stringify(rule.examples) : null,
        confidence: (rule.confidence as any) ?? 'medium',
        modulePattern: rule.modulePattern ?? null,
        priority: rule.priority ?? 0,
        isActive: true,
      }).run();
      seeded++;
    }

    if (seeded > 0) {
      console.log(`Seeded ${seeded} routing rules from ${seedPath}`);
    }
  } catch (err) {
    console.warn('Failed to seed routing rules:', err);
  }
}
