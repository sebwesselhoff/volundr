import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, desc } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/session-summaries — list session summaries
router.get('/projects/:projectId/session-summaries', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string || '10', 10);
  const rows = db.select().from(schema.sessionSummaries)
    .where(eq(schema.sessionSummaries.projectId, req.params.projectId))
    .orderBy(desc(schema.sessionSummaries.endedAt))
    .limit(limit)
    .all();
  res.json(rows);
});

// POST /session-summaries — create session summary
router.post('/session-summaries', (req, res) => {
  try {
    const { projectId, startedAt, summary, keyDecisions, blockers, nextSteps,
            developerFeedback, phaseAtStart, phaseAtEnd, cardsCompleted, cardsStarted } = req.body;
    if (!projectId || !startedAt || !summary) {
      throw new ApiError(400, 'projectId, startedAt, and summary are required');
    }

    const db = getDb();
    const result = db.insert(schema.sessionSummaries).values({
      projectId,
      startedAt,
      summary,
      ...(keyDecisions != null ? { keyDecisions } : {}),
      ...(blockers != null ? { blockers } : {}),
      ...(nextSteps != null ? { nextSteps } : {}),
      ...(developerFeedback != null ? { developerFeedback } : {}),
      ...(phaseAtStart != null ? { phaseAtStart } : {}),
      ...(phaseAtEnd != null ? { phaseAtEnd } : {}),
      ...(cardsCompleted != null ? { cardsCompleted } : {}),
      ...(cardsStarted != null ? { cardsStarted } : {}),
    }).run();

    const [created] = db.select().from(schema.sessionSummaries)
      .where(eq(schema.sessionSummaries.id, Number(result.lastInsertRowid)))
      .all();

    broadcastToAll({ type: 'session_summary:new', data: created as unknown as import('@vldr/shared').SessionSummary });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.statusCode).json({ error: err.message });
    console.error('POST /session-summaries error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
