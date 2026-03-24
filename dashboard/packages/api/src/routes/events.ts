import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, gte, lte, desc, SQL } from 'drizzle-orm';
import type { Event } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/events — paginated events with SQL-level filters
router.get('/projects/:projectId/events', (req, res) => {
  const db = getDb();
  const { type, cardId, from, to, limit: limitStr, offset: offsetStr } = req.query as {
    type?: string;
    cardId?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  };

  const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 1000);
  const offset = parseInt(offsetStr ?? '0', 10) || 0;

  const conditions: SQL[] = [eq(schema.events.projectId, req.params.projectId)];
  if (type) conditions.push(eq(schema.events.type, type));
  if (cardId) conditions.push(eq(schema.events.cardId, cardId));
  if (from) conditions.push(gte(schema.events.timestamp, from));
  if (to) conditions.push(lte(schema.events.timestamp, to));

  const rows = db.select()
    .from(schema.events)
    .where(and(...conditions))
    .orderBy(desc(schema.events.id))
    .limit(limit)
    .offset(offset)
    .all();

  res.json(rows);
});

// POST /events — append event
router.post('/events', (req, res) => {
  const { projectId, cardId, agentId, type, detail, costEstimate } = req.body as {
    projectId?: string;
    cardId?: string;
    agentId?: string;
    type?: string;
    detail?: string;
    costEstimate?: number;
  };
  if (!projectId || !type) throw new ApiError(400, 'projectId and type are required');

  const db = getDb();
  const result = db.insert(schema.events).values({
    projectId,
    type,
    ...(cardId != null ? { cardId } : {}),
    ...(agentId != null ? { agentId } : {}),
    ...(detail != null ? { detail } : {}),
    ...(costEstimate != null ? { costEstimate } : {}),
  }).run();

  const [event] = db.select().from(schema.events).where(eq(schema.events.id, Number(result.lastInsertRowid))).all();
  broadcastToAll({ type: 'event:new', data: event as Event });
  res.status(201).json(event);
});

// DELETE /events/:id — delete a single event
router.delete('/events/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'Invalid event ID');

  db.delete(schema.events).where(eq(schema.events.id, id)).run();
  res.status(204).send();
});

// DELETE /projects/:projectId/events — bulk delete events by type
router.delete('/projects/:projectId/events', (req, res) => {
  const db = getDb();
  const { type } = req.query as { type?: string };

  const conditions: SQL[] = [eq(schema.events.projectId, req.params.projectId)];
  if (type) conditions.push(eq(schema.events.type, type));

  const result = db.delete(schema.events).where(and(...conditions)).run();
  res.json({ deleted: result.changes });
});

export default router;
