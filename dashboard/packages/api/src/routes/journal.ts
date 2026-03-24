import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, desc } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/journal — list journal entries with filters
router.get('/projects/:projectId/journal', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.journal)
    .where(eq(schema.journal.projectId, req.params.projectId))
    .orderBy(desc(schema.journal.timestamp))
    .all();

  let filtered = rows;
  const { entryType, cardId, limit } = req.query as { entryType?: string; cardId?: string; limit?: string };
  if (entryType) filtered = filtered.filter(j => j.entryType === entryType);
  if (cardId) filtered = filtered.filter(j => j.cardId === cardId);
  if (limit) filtered = filtered.slice(0, parseInt(limit, 10));

  res.json(filtered);
});

// POST /journal — create journal entry
router.post('/journal', (req, res) => {
  try {
    const { projectId, entry, entryType, cardId, sessionTag } = req.body;
    if (!projectId || !entry || !entryType) {
      throw new ApiError(400, 'projectId, entry, and entryType are required');
    }

    const db = getDb();
    const result = db.insert(schema.journal).values({
      projectId,
      entry,
      entryType,
      ...(cardId != null ? { cardId } : {}),
      ...(sessionTag != null ? { sessionTag } : {}),
    }).run();

    const [created] = db.select().from(schema.journal)
      .where(eq(schema.journal.id, Number(result.lastInsertRowid)))
      .all();

    broadcastToAll({ type: 'journal:new', data: created as unknown as import('@vldr/shared').JournalEntry });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.statusCode).json({ error: err.message });
    console.error('POST /journal error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
