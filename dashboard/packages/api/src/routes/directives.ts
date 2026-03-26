import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, isNull } from 'drizzle-orm';
import type { Directive } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';

const router = Router();

// GET /directives — list all global directives (no projectId filter)
router.get('/directives', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.directives)
    .where(isNull(schema.directives.projectId))
    .all();
  const { status } = req.query as { status?: string };
  const filtered = status ? rows.filter(d => d.status === status) : rows;
  res.json(filtered as Directive[]);
});

// GET /projects/:projectId/directives — list project + global directives
router.get('/projects/:projectId/directives', (req, res) => {
  const db = getDb();
  const allDirectives = db.select().from(schema.directives).all();
  let filtered = allDirectives.filter(d =>
    d.projectId === req.params.projectId || d.projectId === null
  );
  const { status } = req.query as { status?: string };
  if (status) filtered = filtered.filter(d => d.status === status);
  // Sort by priority desc
  filtered.sort((a, b) => b.priority - a.priority || a.id - b.id);
  res.json(filtered as Directive[]);
});

// GET /directives/:id — get single directive
router.get('/directives/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');
  const db = getDb();
  const [directive] = db.select().from(schema.directives)
    .where(eq(schema.directives.id, id))
    .all();
  if (!directive) throw new ApiError(404, `Directive ${id} not found`);
  res.json(directive as Directive);
});

// POST /directives — create global directive
router.post('/directives', (req, res) => {
  createDirective(null, req, res);
});

// POST /projects/:projectId/directives — create project-scoped directive
router.post('/projects/:projectId/directives', (req, res) => {
  createDirective(req.params.projectId, req, res);
});

function createDirective(projectId: string | null, req: any, res: any) {
  const { content, source, status, priority } = req.body as {
    content?: string;
    source?: string;
    status?: string;
    priority?: number;
  };

  if (!content) throw new ApiError(400, 'content is required');
  if (!source) throw new ApiError(400, 'source is required (confirmed|manual|imported)');

  const db = getDb();
  const result = db.insert(schema.directives).values({
    projectId: projectId ?? undefined,
    content,
    source,
    status: (status as any) ?? 'active',
    priority: priority ?? 0,
  }).run();

  const [created] = db.select().from(schema.directives)
    .where(eq(schema.directives.id, Number(result.lastInsertRowid)))
    .all();
  res.status(201).json(created as Directive);
}

// PATCH /directives/:id — update status, priority, supersede
router.patch('/directives/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');

  const db = getDb();
  const [existing] = db.select().from(schema.directives)
    .where(eq(schema.directives.id, id))
    .all();
  if (!existing) throw new ApiError(404, `Directive ${id} not found`);

  const { content, source, status, priority, supersededBy } = req.body as {
    content?: string;
    source?: string;
    status?: string;
    priority?: number;
    supersededBy?: number;
  };

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const updates: Record<string, unknown> = { updatedAt: now };
  if (content != null) updates.content = content;
  if (source != null) updates.source = source;
  if (status != null) updates.status = status;
  if (priority != null) updates.priority = priority;
  if (supersededBy !== undefined) updates.supersededBy = supersededBy ?? null;

  db.update(schema.directives).set(updates)
    .where(eq(schema.directives.id, id))
    .run();

  const [updated] = db.select().from(schema.directives)
    .where(eq(schema.directives.id, id))
    .all();
  res.json(updated as Directive);
});

// DELETE /directives/:id — soft delete (status = suppressed) or hard delete
router.delete('/directives/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');

  const db = getDb();
  const [existing] = db.select().from(schema.directives)
    .where(eq(schema.directives.id, id))
    .all();
  if (!existing) throw new ApiError(404, `Directive ${id} not found`);

  if (req.query.hard === 'true') {
    db.delete(schema.directives).where(eq(schema.directives.id, id)).run();
  } else {
    db.update(schema.directives)
      .set({ status: 'suppressed', updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') })
      .where(eq(schema.directives.id, id))
      .run();
  }
  res.status(204).send();
});

export default router;
