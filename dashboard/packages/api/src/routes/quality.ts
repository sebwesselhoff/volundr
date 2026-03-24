import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, inArray } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';

const router = Router();

// GET /projects/:projectId/quality — list quality scores via INNER JOIN with cards
router.get('/projects/:projectId/quality', (req, res) => {
  const db = getDb();
  const rows = db.select({
    id: schema.qualityScores.id,
    cardId: schema.qualityScores.cardId,
    completeness: schema.qualityScores.completeness,
    codeQuality: schema.qualityScores.codeQuality,
    formatCompliance: schema.qualityScores.formatCompliance,
    independence: schema.qualityScores.independence,
    weightedScore: schema.qualityScores.weightedScore,
    implementationType: schema.qualityScores.implementationType,
    createdAt: schema.qualityScores.createdAt,
    updatedAt: schema.qualityScores.updatedAt,
  })
    .from(schema.qualityScores)
    .innerJoin(schema.cards, eq(schema.qualityScores.cardId, schema.cards.id))
    .where(eq(schema.cards.projectId, req.params.projectId))
    .all();

  res.json(rows);
});

// POST /quality — upsert quality score
router.post('/quality', (req, res) => {
  const { cardId, completeness, codeQuality, formatCompliance, independence, implementationType } = req.body as {
    cardId?: string;
    completeness?: number;
    codeQuality?: number;
    formatCompliance?: number;
    independence?: number;
    implementationType?: string;
  };
  if (!cardId) throw new ApiError(400, 'cardId is required');

  const db = getDb();
  const [card] = db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.id, cardId)).all();
  if (!card) throw new ApiError(404, `Card ${cardId} not found`);

  const C = completeness ?? 0;
  const Q = codeQuality ?? 0;
  const F = formatCompliance ?? 0;
  const I = independence ?? 0;
  const weightedScore = (C * 3 + Q * 3 + F * 2 + I * 2) / 10;

  const [existing] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.cardId, cardId)).all();

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  if (existing) {
    db.update(schema.qualityScores).set({
      completeness: C,
      codeQuality: Q,
      formatCompliance: F,
      independence: I,
      weightedScore,
      ...(implementationType != null ? { implementationType } : {}),
      updatedAt: now,
    }).where(eq(schema.qualityScores.cardId, cardId)).run();

    const [updated] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.cardId, cardId)).all();
    return res.json(updated);
  }

  const result = db.insert(schema.qualityScores).values({
    cardId,
    completeness: C,
    codeQuality: Q,
    formatCompliance: F,
    independence: I,
    weightedScore,
    implementationType: implementationType ?? 'unknown',
  }).run();

  const [created] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.id, Number(result.lastInsertRowid))).all();
  res.status(201).json(created);
});

export default router;
