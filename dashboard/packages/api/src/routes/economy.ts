import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import type { Project } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/economy — get current economy mode state
router.get('/projects/:projectId/economy', (req, res) => {
  const db = getDb();
  const [project] = db.select({ id: schema.projects.id, economyMode: schema.projects.economyMode })
    .from(schema.projects)
    .where(eq(schema.projects.id, req.params.projectId))
    .all();
  if (!project) throw new ApiError(404, `Project ${req.params.projectId} not found`);
  res.json({ projectId: req.params.projectId, economyMode: project.economyMode ?? false });
});

// POST /projects/:projectId/economy — toggle or set economy mode
// Body: { enabled: boolean } or { toggle: true }
router.post('/projects/:projectId/economy', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.projects)
    .where(eq(schema.projects.id, req.params.projectId))
    .all();
  if (!existing) throw new ApiError(404, `Project ${req.params.projectId} not found`);

  const { enabled, toggle } = req.body as { enabled?: boolean; toggle?: boolean };

  if (enabled === undefined && !toggle) {
    throw new ApiError(400, 'Provide either { enabled: boolean } or { toggle: true }');
  }

  const newValue = toggle ? !existing.economyMode : enabled!;
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  db.update(schema.projects)
    .set({ economyMode: newValue, updatedAt: now })
    .where(eq(schema.projects.id, req.params.projectId))
    .run();

  const [updated] = db.select().from(schema.projects)
    .where(eq(schema.projects.id, req.params.projectId))
    .all();

  broadcastToAll({ type: 'project:updated', data: updated as Project });
  res.json({ projectId: req.params.projectId, economyMode: updated.economyMode ?? false });
});

export default router;
