import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
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
    correctness: schema.qualityScores.correctness,
    weightedScore: schema.qualityScores.weightedScore,
    implementationType: schema.qualityScores.implementationType,
    reviewType: schema.qualityScores.reviewType,
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
  const { cardId, completeness, codeQuality, formatCompliance, correctness, independence, implementationType, reviewType } = req.body as {
    cardId?: string;
    completeness?: number;
    codeQuality?: number;
    formatCompliance?: number;
    correctness?: number;
    independence?: number; // backward compat — maps to correctness
    implementationType?: string;
    reviewType?: string;
  };
  if (!cardId) throw new ApiError(400, 'cardId is required');

  const db = getDb();
  const [card] = db.select({ id: schema.cards.id, projectId: schema.cards.projectId })
    .from(schema.cards).where(eq(schema.cards.id, cardId)).all();
  if (!card) throw new ApiError(404, `Card ${cardId} not found`);

  // Accept either correctness or independence (backward compat)
  const effectiveCorrectness = correctness ?? independence;

  // Validate score ranges (1-10 scale)
  const SCORE_MIN = 1, SCORE_MAX = 10;
  for (const [key, val] of Object.entries({ completeness, codeQuality, formatCompliance, correctness: effectiveCorrectness })) {
    if (val != null && (typeof val !== 'number' || val < SCORE_MIN || val > SCORE_MAX)) {
      throw new ApiError(400, `${key} must be between ${SCORE_MIN} and ${SCORE_MAX}, got ${val}`);
    }
  }

  const C = completeness ?? 0;
  const Q = codeQuality ?? 0;
  const F = formatCompliance ?? 0;
  const R = effectiveCorrectness ?? 0;
  const weightedScore = (C * 3 + Q * 3 + F * 2 + R * 2) / 10;

  const effectiveReviewType = reviewType ?? 'self';

  const [existing] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.cardId, cardId)).all();

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  let scoreRow: typeof schema.qualityScores.$inferSelect;

  if (existing) {
    db.update(schema.qualityScores).set({
      completeness: C,
      codeQuality: Q,
      formatCompliance: F,
      correctness: R,
      weightedScore,
      reviewType: effectiveReviewType,
      ...(implementationType != null ? { implementationType } : {}),
      updatedAt: now,
    }).where(eq(schema.qualityScores.cardId, cardId)).run();

    [scoreRow] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.cardId, cardId)).all();
  } else {
    const result = db.insert(schema.qualityScores).values({
      cardId,
      completeness: C,
      codeQuality: Q,
      formatCompliance: F,
      correctness: R,
      weightedScore,
      implementationType: implementationType ?? 'unknown',
      reviewType: effectiveReviewType,
    }).run();

    [scoreRow] = db.select().from(schema.qualityScores).where(eq(schema.qualityScores.id, Number(result.lastInsertRowid))).all();
  }

  // Gate 6: optimization cycle nudge every 5 done cards in the project
  try {
    const doneCards = db.select({ id: schema.cards.id })
      .from(schema.cards)
      .where(eq(schema.cards.projectId, card.projectId))
      .all()
      .filter(c => {
        const qs = db.select({ id: schema.qualityScores.id })
          .from(schema.qualityScores)
          .where(eq(schema.qualityScores.cardId, c.id))
          .all();
        return qs.length > 0;
      });
    const doneCount = doneCards.length;
    if (doneCount > 0 && doneCount % 5 === 0) {
      db.insert(schema.commands).values({
        id: uuid(),
        projectId: card.projectId,
        type: 'optimization_cycle_due',
        detail: `${doneCount} cards scored — time for an optimization review`,
        status: 'pending',
      }).run();
    }
  } catch { /* nudge failure must not block the response */ }

  res.status(existing ? 200 : 201).json(scoreRow!);
});

export default router;
