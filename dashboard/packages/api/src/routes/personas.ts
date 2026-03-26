import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, desc } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';
import type { Persona, PersonaHistoryEntry } from '@vldr/shared';

const router = Router();

function tryParseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

function parsePersonaJsonFields(row: typeof schema.personas.$inferSelect) {
  return {
    ...row,
    expertise: row.expertise ? tryParseJson(row.expertise) : null,
  };
}

// GET /personas — list all personas (optional ?status filter)
router.get('/personas', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.personas).all();
  const { status } = req.query as { status?: string };
  const filtered = status ? rows.filter(p => p.status === status) : rows;
  res.json(filtered.map(parsePersonaJsonFields));
});

// GET /personas/:id — single persona
router.get('/personas/:id', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);
  res.json(parsePersonaJsonFields(persona));
});

// POST /personas — create persona
router.post('/personas', (req, res) => {
  const {
    id, name, role, expertise, style, modelPreference,
    status, charterPath, historyPath,
  } = req.body as {
    id?: string;
    name?: string;
    role?: string;
    expertise?: string[];
    style?: string;
    modelPreference?: string;
    status?: string;
    charterPath?: string;
    historyPath?: string;
  };

  if (!id || !name || !role) {
    throw new ApiError(400, 'id, name, and role are required');
  }

  const db = getDb();
  db.insert(schema.personas).values({
    id,
    name,
    role,
    ...(expertise != null ? { expertise: JSON.stringify(expertise) } : {}),
    ...(style != null ? { style } : {}),
    ...(modelPreference != null ? { modelPreference } : {}),
    ...(status != null ? { status } : {}),
    ...(charterPath != null ? { charterPath } : {}),
    ...(historyPath != null ? { historyPath } : {}),
  }).run();

  const [created] = db.select().from(schema.personas).where(eq(schema.personas.id, id)).all();
  const parsed = parsePersonaJsonFields(created);
  broadcastToAll({ type: 'persona:created', data: parsed as unknown as Persona });
  res.status(201).json(parsed);
});

// PATCH /personas/:id — update persona
router.patch('/personas/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const {
    name, role, expertise, style, modelPreference, status,
    cardsCompleted, qualityAverage, totalTokens, totalCost,
    lastActiveAt, charterPath, historyPath,
  } = req.body as {
    name?: string;
    role?: string;
    expertise?: string[];
    style?: string;
    modelPreference?: string;
    status?: string;
    cardsCompleted?: number;
    qualityAverage?: number;
    totalTokens?: number;
    totalCost?: number;
    lastActiveAt?: string;
    charterPath?: string;
    historyPath?: string;
  };

  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (role != null) updates.role = role;
  if (expertise != null) updates.expertise = JSON.stringify(expertise);
  if (style != null) updates.style = style;
  if (modelPreference != null) updates.modelPreference = modelPreference;
  if (status != null) updates.status = status;
  if (cardsCompleted != null) updates.cardsCompleted = cardsCompleted;
  if (qualityAverage != null) updates.qualityAverage = qualityAverage;
  if (totalTokens != null) updates.totalTokens = totalTokens;
  if (totalCost != null) updates.totalCost = totalCost;
  if (lastActiveAt != null) updates.lastActiveAt = lastActiveAt;
  if (charterPath != null) updates.charterPath = charterPath;
  if (historyPath != null) updates.historyPath = historyPath;

  db.update(schema.personas).set(updates).where(eq(schema.personas.id, req.params.id)).run();

  const [updated] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  const parsed = parsePersonaJsonFields(updated);
  broadcastToAll({ type: 'persona:updated', data: parsed as unknown as Persona });
  res.json(parsed);
});

// DELETE /personas/:id — delete persona
router.delete('/personas/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Persona ${req.params.id} not found`);
  db.delete(schema.personas).where(eq(schema.personas.id, req.params.id)).run();
  res.status(204).send();
});

// GET /personas/:id/history — list history entries (optional ?section filter)
router.get('/personas/:id/history', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const rows = db.select().from(schema.personaHistoryEntries)
    .where(eq(schema.personaHistoryEntries.personaId, req.params.id))
    .orderBy(desc(schema.personaHistoryEntries.createdAt))
    .all();

  const { section } = req.query as { section?: string };
  const filtered = section ? rows.filter(e => e.section === section) : rows;

  res.json(filtered.map(e => ({
    ...e,
    stackTags: e.stackTags ? tryParseJson(e.stackTags) : null,
  })));
});

// POST /personas/:id/history — add history entry
router.post('/personas/:id/history', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const { section, content, projectId, stackTags, confidence } = req.body as {
    section?: string;
    content?: string;
    projectId?: string;
    stackTags?: string[];
    confidence?: number;
  };

  if (!section || !content) {
    throw new ApiError(400, 'section and content are required');
  }

  const result = db.insert(schema.personaHistoryEntries).values({
    personaId: req.params.id,
    section,
    content,
    ...(projectId != null ? { projectId } : {}),
    ...(stackTags != null ? { stackTags: JSON.stringify(stackTags) } : {}),
    ...(confidence != null ? { confidence } : {}),
  }).run();

  const [created] = db.select().from(schema.personaHistoryEntries)
    .where(eq(schema.personaHistoryEntries.id, Number(result.lastInsertRowid)))
    .all();

  const parsed = { ...created, stackTags: created.stackTags ? tryParseJson(created.stackTags) : null };
  broadcastToAll({ type: 'persona:history_entry', data: parsed as unknown as PersonaHistoryEntry });
  res.status(201).json(parsed);
});

export default router;
