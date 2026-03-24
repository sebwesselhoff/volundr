import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, gte, desc, SQL } from 'drizzle-orm';
import type { LogEntry } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// POST /logs — create a log entry
router.post('/logs', (req, res) => {
  const { projectId, level, source, event, detail, agentId, cardId, error } = req.body as {
    projectId?: string;
    level?: string;
    source?: string;
    event?: string;
    detail?: string;
    agentId?: string;
    cardId?: string;
    error?: string;
  };

  if (!level || !source || !event) {
    throw new ApiError(400, 'level, source, and event are required');
  }

  const truncatedError = error != null ? error.slice(0, 2000) : undefined;

  const db = getDb();
  const result = db.insert(schema.hookLogs).values({
    ...(projectId != null ? { projectId } : {}),
    level,
    source,
    event,
    ...(detail != null ? { detail } : {}),
    ...(agentId != null ? { agentId } : {}),
    ...(cardId != null ? { cardId } : {}),
    ...(truncatedError != null ? { error: truncatedError } : {}),
  }).run();

  const [logEntry] = db.select()
    .from(schema.hookLogs)
    .where(eq(schema.hookLogs.id, Number(result.lastInsertRowid)))
    .all();

  broadcastToAll({ type: 'log:entry', data: logEntry as LogEntry });
  res.status(201).json(logEntry);
});

// GET /projects/:projectId/logs — query logs with filters
router.get('/projects/:projectId/logs', (req, res) => {
  const { level, source, since, limit: limitStr } = req.query as {
    level?: string;
    source?: string;
    since?: string;
    limit?: string;
  };

  const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 1000);

  const conditions: SQL[] = [eq(schema.hookLogs.projectId, req.params.projectId)];
  if (level) conditions.push(eq(schema.hookLogs.level, level));
  if (source) conditions.push(eq(schema.hookLogs.source, source));
  if (since) conditions.push(gte(schema.hookLogs.timestamp, since));

  const db = getDb();
  const rows = db.select()
    .from(schema.hookLogs)
    .where(and(...conditions))
    .orderBy(desc(schema.hookLogs.timestamp))
    .limit(limit)
    .all();

  res.json(rows);
});

export default router;
