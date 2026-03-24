import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Project } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET / — list all projects
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.projects).all();
  res.json(rows);
});

// GET /:id/exists — check if project ID is taken
router.get('/:id/exists', (req, res) => {
  const db = getDb();
  const [row] = db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, req.params.id))
    .all();
  res.json({ exists: !!row });
});

// GET /:id — get project by id
router.get('/:id', (req, res) => {
  const db = getDb();
  const [row] = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).all();
  if (!row) throw new ApiError(404, `Project ${req.params.id} not found`);
  res.json(row);
});

// POST / — create project
router.post('/', (req, res) => {
  const { id, name, path, status, phase, reviewGateLevel } = req.body as {
    id?: string;
    name?: string;
    path?: string;
    status?: string;
    phase?: string;
    reviewGateLevel?: number;
  };
  if (!id || !name || !path) throw new ApiError(400, 'id, name, and path are required');

  const db = getDb();

  // Transaction: insert project + volundr agent atomically
  const result = db.transaction((tx) => {
    tx.insert(schema.projects).values({
      id,
      name,
      path,
      ...(status ? { status } : {}),
      ...(phase ? { phase } : {}),
      ...(reviewGateLevel != null ? { reviewGateLevel } : {}),
    }).run();

    const agentId = uuid();
    tx.insert(schema.agents).values({
      id: agentId,
      projectId: id,
      type: 'volundr',
      model: 'opus-4',
      status: 'running',
    }).run();

    const [project] = tx.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
    return project;
  });

  res.status(201).json(result);
});

// PATCH /:id — update project
router.patch('/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Project ${req.params.id} not found`);

  const { name, status, phase, reviewGateLevel } = req.body as {
    name?: string;
    status?: string;
    phase?: string;
    reviewGateLevel?: number;
  };

  const validPhases = ['discovery', 'planning', 'implementation', 'testing', 'maintenance', 'complete'];
  const validStatuses = ['active', 'paused', 'completed', 'archived'];

  if (phase != null && !validPhases.includes(phase)) {
    throw new ApiError(400, `Invalid phase "${phase}". Must be one of: ${validPhases.join(', ')}`);
  }
  if (status != null && !validStatuses.includes(status)) {
    throw new ApiError(400, `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`);
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
  };
  if (name != null) updates.name = name;
  if (status != null) updates.status = status;
  if (phase != null) updates.phase = phase;
  if (reviewGateLevel != null) updates.reviewGateLevel = reviewGateLevel;

  db.update(schema.projects).set(updates).where(eq(schema.projects.id, req.params.id)).run();

  const [updated] = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).all();
  broadcastToAll({ type: 'project:updated', data: updated as Project });
  res.json(updated);
});

// DELETE /:id — delete project (CASCADE handles children)
router.delete('/:id', (req, res) => {
  const confirm = req.headers['x-confirm-delete'];
  if (confirm !== 'true') throw new ApiError(400, 'Header X-Confirm-Delete: true is required');

  const db = getDb();
  const [existing] = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Project ${req.params.id} not found`);

  db.delete(schema.projects).where(eq(schema.projects.id, req.params.id)).run();
  res.status(204).send();
});

export default router;
