import type { Request, Response, NextFunction } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { broadcastToAll } from '../ws/broadcast.js';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message });
  } else if (err.type === 'entity.parse.failed' || err.status === 400) {
    res.status(400).json({ error: 'Invalid JSON in request body' });
  } else {
    console.error(`[API] ${req.method} ${req.path} →`, err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }

  try {
    const db = getDb();
    const result = db.insert(schema.hookLogs).values({
      level: err instanceof ApiError ? 'warn' : 'error',
      source: 'api',
      event: 'request_error',
      detail: `${req.method} ${req.path} → ${err instanceof ApiError ? err.statusCode : 500}`,
      error: (err.stack || err.message || String(err)).slice(0, 2000),
    }).run();

    const [logEntry] = db.select()
      .from(schema.hookLogs)
      .where(eq(schema.hookLogs.id, Number(result.lastInsertRowid)))
      .all();

    broadcastToAll({ type: 'log:entry', data: logEntry as any });
  } catch {
    // Last resort — can't log the logging failure
    console.error('Failed to log error:', err);
  }
}
