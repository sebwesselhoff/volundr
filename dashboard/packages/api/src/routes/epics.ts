import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Epic } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/epics — list epics for project
router.get('/projects/:projectId/epics', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.epics).where(eq(schema.epics.projectId, req.params.projectId)).all();
  res.json(rows);
});

// POST /projects/:projectId/epics — create epic
router.post('/projects/:projectId/epics', (req, res) => {
  const { name, domain, color, sortOrder } = req.body as {
    name?: string;
    domain?: string;
    color?: string;
    sortOrder?: number;
  };
  if (!name || !domain || !color) throw new ApiError(400, 'name, domain, and color are required');

  const db = getDb();
  const id = uuid();

  db.insert(schema.epics).values({
    id,
    projectId: req.params.projectId,
    name,
    domain,
    color,
    ...(sortOrder != null ? { sortOrder } : {}),
  }).run();

  const [epic] = db.select().from(schema.epics).where(eq(schema.epics.id, id)).all();
  broadcastToAll({ type: 'epic:created', data: epic as Epic });
  res.status(201).json(epic);
});

// PATCH /epics/:id — update epic
router.patch('/epics/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.epics).where(eq(schema.epics.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Epic ${req.params.id} not found`);

  const { name, domain, color, sortOrder } = req.body as {
    name?: string;
    domain?: string;
    color?: string;
    sortOrder?: number;
  };

  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (domain != null) updates.domain = domain;
  if (color != null) updates.color = color;
  if (sortOrder != null) updates.sortOrder = sortOrder;

  db.update(schema.epics).set(updates).where(eq(schema.epics.id, req.params.id)).run();

  const [updated] = db.select().from(schema.epics).where(eq(schema.epics.id, req.params.id)).all();
  broadcastToAll({ type: 'epic:updated', data: updated as Epic });
  res.json(updated);
});

// DELETE /epics/:id — delete epic (reject if cards exist)
router.delete('/epics/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.epics).where(eq(schema.epics.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Epic ${req.params.id} not found`);

  const [cardCount] = db.select({ count: count() }).from(schema.cards).where(eq(schema.cards.epicId, req.params.id)).all();
  if (cardCount.count > 0) {
    throw new ApiError(400, `Cannot delete epic ${req.params.id}: ${cardCount.count} card(s) still exist`);
  }

  db.delete(schema.epics).where(eq(schema.epics.id, req.params.id)).run();
  res.status(204).send();
});

export default router;
