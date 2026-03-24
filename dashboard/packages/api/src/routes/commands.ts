import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '@vldr/db';
import { broadcastToBrowsers } from '../ws/broadcast.js';

export const commandsRouter = Router();

// GET /api/projects/:projectId/commands/pending — Volundr polls this
commandsRouter.get('/projects/:projectId/commands/pending', async (req, res) => {
  const { projectId } = req.params;
  const pending = getDb()
    .select()
    .from(schema.commands)
    .where(and(eq(schema.commands.projectId, projectId), eq(schema.commands.status, 'pending')))
    .all();
  res.json(pending);
});

// POST /api/commands — create a command (from WS handler or directly)
commandsRouter.post('/commands', async (req, res) => {
  const { projectId, type, cardId, detail, payload } = req.body;
  if (!projectId || !type) {
    return res.status(400).json({ error: 'projectId and type are required' });
  }

  const id = uuid();
  const [command] = getDb()
    .insert(schema.commands)
    .values({
      id,
      projectId,
      type,
      cardId: cardId || null,
      detail: detail || null,
      payload: payload ? JSON.stringify(payload) : null,
      status: 'pending',
    })
    .returning()
    .all();

  broadcastToBrowsers({
    type: 'command:pending',
    data: { commandId: id, commandType: type, target: cardId || projectId },
  });

  res.status(201).json(command);
});

// POST /api/commands/:id/ack — Volundr acknowledges a command
commandsRouter.post('/commands/:id/ack', async (req, res) => {
  const { id } = req.params;
  const { success, detail } = req.body;

  const [command] = getDb()
    .select()
    .from(schema.commands)
    .where(eq(schema.commands.id, id))
    .all();

  if (!command) {
    return res.status(404).json({ error: 'Command not found' });
  }

  const [updated] = getDb()
    .update(schema.commands)
    .set({
      status: success ? 'acknowledged' : 'failed',
      detail: detail || command.detail,
      acknowledgedAt: new Date().toISOString(),
    })
    .where(eq(schema.commands.id, id))
    .returning()
    .all();

  if (success) {
    broadcastToBrowsers({ type: 'command:acknowledged', data: { commandId: id } });
  } else {
    broadcastToBrowsers({ type: 'command:failed', data: { commandId: id, reason: detail || 'Rejected' } });
  }

  res.json(updated);
});
