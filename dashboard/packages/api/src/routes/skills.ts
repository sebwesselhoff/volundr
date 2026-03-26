import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, like, or } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import type { CreateSkillInput, UpdateSkillInput } from '@vldr/shared';

const router = Router();

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function toSkill(row: typeof schema.skills.$inferSelect) {
  return {
    ...row,
    triggers: parseJsonArray(row.triggers),
    roles: parseJsonArray(row.roles),
  };
}

// GET /skills — list all skills, optional ?domain=&q= filters
router.get('/skills', (req, res) => {
  const db = getDb();
  let rows = db.select().from(schema.skills).all();

  const { domain, q } = req.query as { domain?: string; q?: string };
  if (domain) {
    rows = rows.filter((r) => r.domain === domain);
  }
  if (q) {
    const lower = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.description.toLowerCase().includes(lower) ||
        r.domain.toLowerCase().includes(lower),
    );
  }

  res.json(rows.map(toSkill));
});

// GET /skills/:id — get one skill
router.get('/skills/:id', (req, res) => {
  const db = getDb();
  const [row] = db.select().from(schema.skills).where(eq(schema.skills.id, req.params.id)).all();
  if (!row) throw new ApiError(404, `Skill '${req.params.id}' not found`);
  res.json(toSkill(row));
});

// POST /skills — create skill
router.post('/skills', (req, res) => {
  const body = req.body as CreateSkillInput;
  if (!body.id) throw new ApiError(400, 'id is required');
  if (!body.name) throw new ApiError(400, 'name is required');
  if (!body.description) throw new ApiError(400, 'description is required');
  if (!body.domain) throw new ApiError(400, 'domain is required');

  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsLater = new Date(Date.now() + 182 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const db = getDb();
  db.insert(schema.skills).values({
    id: body.id,
    name: body.name,
    description: body.description,
    domain: body.domain,
    confidence: body.confidence ?? 'medium',
    source: body.source ?? 'seed',
    version: body.version ?? 1,
    validatedAt: body.validatedAt ?? today,
    reviewByDate: body.reviewByDate ?? sixMonthsLater,
    triggers: JSON.stringify(body.triggers ?? []),
    roles: JSON.stringify(body.roles ?? []),
    body: body.body ?? '',
  }).run();

  const [row] = db.select().from(schema.skills).where(eq(schema.skills.id, body.id)).all();
  res.status(201).json(toSkill(row));
});

// PATCH /skills/:id — update skill
router.patch('/skills/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.skills).where(eq(schema.skills.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Skill '${req.params.id}' not found`);

  const body = req.body as UpdateSkillInput;
  const updates: Partial<typeof schema.skills.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.domain !== undefined) updates.domain = body.domain;
  if (body.confidence !== undefined) updates.confidence = body.confidence;
  if (body.version !== undefined) updates.version = body.version;
  if (body.validatedAt !== undefined) updates.validatedAt = body.validatedAt;
  if (body.reviewByDate !== undefined) updates.reviewByDate = body.reviewByDate;
  if (body.triggers !== undefined) updates.triggers = JSON.stringify(body.triggers);
  if (body.roles !== undefined) updates.roles = JSON.stringify(body.roles);
  if (body.body !== undefined) updates.body = body.body;

  db.update(schema.skills).set(updates).where(eq(schema.skills.id, req.params.id)).run();

  const [row] = db.select().from(schema.skills).where(eq(schema.skills.id, req.params.id)).all();
  res.json(toSkill(row));
});

// DELETE /skills/:id — delete skill
router.delete('/skills/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.skills).where(eq(schema.skills.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Skill '${req.params.id}' not found`);

  db.delete(schema.skills).where(eq(schema.skills.id, req.params.id)).run();
  res.status(204).send();
});

// Confidence weight multiplier — high-confidence skills rank above low ones at equal keyword score
const CONFIDENCE_WEIGHT: Record<string, number> = { high: 1.5, medium: 1.0, low: 0.6 };

// POST /skills/match — find relevant skills for a given query/context
// Scoring: trigger match = +2 per term (2× weight), name/description match = +1 per term.
// Raw score is multiplied by confidence weight (high=1.5, medium=1.0, low=0.6).
router.post('/skills/match', (req, res) => {
  const { query, domain, roles, limit } = req.body as {
    query?: string;
    domain?: string;
    roles?: string[];
    limit?: number;
  };

  if (!query) throw new ApiError(400, 'query is required');

  const db = getDb();
  const allSkills = db.select().from(schema.skills).all();

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = allSkills
    .map((row) => {
      const triggers = parseJsonArray(row.triggers);
      const skillRoles = parseJsonArray(row.roles);

      // Filter by domain if specified
      if (domain && row.domain !== domain) return null;

      // Filter by roles if specified (empty skill.roles = available to all)
      if (roles && roles.length > 0 && skillRoles.length > 0) {
        const hasRole = roles.some((r) => skillRoles.includes(r));
        if (!hasRole) return null;
      }

      // Score: trigger matches weighted 2x, name/description matches 1x
      let rawScore = 0;
      const matchedTriggers: string[] = [];

      for (const term of queryTerms) {
        for (const trigger of triggers) {
          const triggerLower = trigger.toLowerCase();
          if (triggerLower.includes(term) || term.includes(triggerLower)) {
            rawScore += 2;
            if (!matchedTriggers.includes(trigger)) matchedTriggers.push(trigger);
          }
        }
        if (row.name.toLowerCase().includes(term)) rawScore += 1;
        if (row.description.toLowerCase().includes(term)) rawScore += 1;
      }

      if (rawScore === 0) return null;

      // Apply confidence multiplier so high-confidence skills surface first
      const weight = CONFIDENCE_WEIGHT[row.confidence] ?? 1.0;
      const score = rawScore * weight;

      return { skill: toSkill(row), score, matchedTriggers };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, limit ?? 10);

  res.json(scored);
});

export default router;
