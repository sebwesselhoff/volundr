import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, or } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';

const router = Router();

// GET /projects/:projectId/lessons — list lessons for project OR global
router.get('/projects/:projectId/lessons', (req, res) => {
  const db = getDb();
  const rows = db.select()
    .from(schema.lessons)
    .where(
      or(
        eq(schema.lessons.projectId, req.params.projectId),
        eq(schema.lessons.isGlobal, true),
      )
    )
    .all();

  res.json(rows);
});

// POST /lessons — create lesson
router.post('/lessons', (req, res) => {
  const { projectId, title, content, stack, source, isGlobal } = req.body as {
    projectId?: string;
    title?: string;
    content?: string;
    stack?: string;
    source?: string;
    isGlobal?: boolean;
  };
  if (!title || !content) throw new ApiError(400, 'title and content are required');

  const db = getDb();
  const result = db.insert(schema.lessons).values({
    ...(projectId != null ? { projectId } : {}),
    title,
    content,
    ...(stack != null ? { stack } : {}),
    ...(source != null ? { source } : {}),
    isGlobal: isGlobal ?? false,
  }).run();

  const [lesson] = db.select().from(schema.lessons).where(eq(schema.lessons.id, Number(result.lastInsertRowid))).all();
  res.status(201).json(lesson);
});

// GET /lessons/export — export all global lessons in seed.json format
router.get('/lessons/export', (_req, res) => {
  const db = getDb();
  const rows = db.select()
    .from(schema.lessons)
    .where(eq(schema.lessons.isGlobal, true))
    .all();

  const exported = rows.map(l => ({
    title: l.title,
    content: l.content,
    stack: l.stack || '',
    source: l.source || 'community',
  }));

  res.json(exported);
});

export default router;
