import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, desc } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';
import type { Persona, PersonaHistoryEntry, PersonaStats } from '@vldr/shared';

const router = Router();

// GET /personas — list all personas
router.get('/personas', (_req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.personas).all();
  res.json(rows);
});

// GET /personas/:id — get single persona
router.get('/personas/:id', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);
  res.json(persona);
});

// POST /personas — create persona
router.post('/personas', (req, res) => {
  const {
    id, name, role, expertise, style, modelPreference,
    charterContent, historyContent, source,
  } = req.body as {
    id?: string;
    name?: string;
    role?: string;
    expertise?: string;
    style?: string;
    modelPreference?: string;
    charterContent?: string;
    historyContent?: string;
    source?: string;
  };

  if (!id || !name || !role) {
    throw new ApiError(400, 'id, name, and role are required');
  }

  const db = getDb();
  db.insert(schema.personas).values({
    id,
    name,
    role,
    expertise: expertise ?? '',
    style: style ?? '',
    modelPreference: modelPreference ?? 'auto',
    charterContent: charterContent ?? '',
    historyContent: historyContent ?? '',
    source: source ?? 'user',
  }).run();

  // Init stats row
  db.insert(schema.personaStats).values({ personaId: id }).run();

  const [created] = db.select().from(schema.personas).where(eq(schema.personas.id, id)).all();
  broadcastToAll({ type: 'persona:created', data: created as Persona });
  res.status(201).json(created);
});

// PATCH /personas/:id — update persona
router.patch('/personas/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const {
    name, role, expertise, style, modelPreference,
    charterContent, historyContent,
  } = req.body as {
    name?: string;
    role?: string;
    expertise?: string;
    style?: string;
    modelPreference?: string;
    charterContent?: string;
    historyContent?: string;
  };

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const updates: Record<string, unknown> = { updatedAt: now };
  if (name != null) updates.name = name;
  if (role != null) updates.role = role;
  if (expertise != null) updates.expertise = expertise;
  if (style != null) updates.style = style;
  if (modelPreference != null) updates.modelPreference = modelPreference;
  if (charterContent != null) updates.charterContent = charterContent;
  if (historyContent != null) updates.historyContent = historyContent;

  db.update(schema.personas).set(updates).where(eq(schema.personas.id, req.params.id)).run();

  const [updated] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  broadcastToAll({ type: 'persona:updated', data: updated as Persona });
  res.json(updated);
});

// DELETE /personas/:id — delete persona
router.delete('/personas/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Persona ${req.params.id} not found`);
  if (existing.source === 'seed') throw new ApiError(400, 'Cannot delete seed personas');
  db.delete(schema.personas).where(eq(schema.personas.id, req.params.id)).run();
  res.status(204).send();
});

// GET /personas/:id/history — list history entries for a persona
router.get('/personas/:id/history', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const rows = db.select().from(schema.personaHistoryEntries)
    .where(eq(schema.personaHistoryEntries.personaId, req.params.id))
    .orderBy(desc(schema.personaHistoryEntries.createdAt))
    .all();

  const { entryType } = req.query as { entryType?: string };
  const filtered = entryType ? rows.filter(e => e.entryType === entryType) : rows;

  res.json(filtered);
});

// POST /personas/:id/history — add history entry
router.post('/personas/:id/history', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const { entryType, content, projectId, stackTag, projectName } = req.body as {
    entryType?: string;
    content?: string;
    projectId?: string;
    stackTag?: string;
    projectName?: string;
  };

  if (!entryType || !content) {
    throw new ApiError(400, 'entryType and content are required');
  }

  const result = db.insert(schema.personaHistoryEntries).values({
    personaId: req.params.id,
    entryType,
    content,
    ...(projectId != null ? { projectId } : {}),
    ...(stackTag != null ? { stackTag } : {}),
    ...(projectName != null ? { projectName } : {}),
  }).run();

  const [created] = db.select().from(schema.personaHistoryEntries)
    .where(eq(schema.personaHistoryEntries.id, Number(result.lastInsertRowid)))
    .all();

  broadcastToAll({ type: 'persona:history_entry', data: created as PersonaHistoryEntry });
  res.status(201).json(created);
});

// GET /personas/:id/skills — list skills assigned to persona
router.get('/personas/:id/skills', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const rows = db.select().from(schema.personaSkills)
    .where(eq(schema.personaSkills.personaId, req.params.id))
    .all();
  res.json(rows);
});

// POST /personas/:id/skills — assign skill to persona
router.post('/personas/:id/skills', (req, res) => {
  const db = getDb();
  const [persona] = db.select().from(schema.personas).where(eq(schema.personas.id, req.params.id)).all();
  if (!persona) throw new ApiError(404, `Persona ${req.params.id} not found`);

  const { skillId } = req.body as { skillId?: string };
  if (!skillId) throw new ApiError(400, 'skillId is required');

  const result = db.insert(schema.personaSkills).values({
    personaId: req.params.id,
    skillId,
  }).run();

  const [created] = db.select().from(schema.personaSkills)
    .where(eq(schema.personaSkills.id, Number(result.lastInsertRowid)))
    .all();
  res.status(201).json(created);
});

// DELETE /personas/:id/skills/:skillId — remove skill from persona
router.delete('/personas/:id/skills/:skillId', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.personaSkills)
    .where(eq(schema.personaSkills.personaId, req.params.id))
    .all();
  const match = rows.find(s => s.skillId === req.params.skillId);
  if (!match) throw new ApiError(404, `Skill ${req.params.skillId} not assigned to persona ${req.params.id}`);
  db.delete(schema.personaSkills).where(eq(schema.personaSkills.id, match.id)).run();
  res.status(204).send();
});

// GET /personas/:id/stats — persona statistics
router.get('/personas/:id/stats', (req, res) => {
  const db = getDb();
  const [stats] = db.select().from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .all();
  if (!stats) throw new ApiError(404, `Stats for persona ${req.params.id} not found`);
  res.json(stats as PersonaStats);
});

// PATCH /personas/:id/stats — update persona statistics
router.patch('/personas/:id/stats', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .all();
  if (!existing) throw new ApiError(404, `Stats for persona ${req.params.id} not found`);

  const { projectCount, cardCount, qualityAvg } = req.body as {
    projectCount?: number;
    cardCount?: number;
    qualityAvg?: number | null;
  };

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const updates: Record<string, unknown> = { updatedAt: now };
  if (projectCount != null) updates.projectCount = projectCount;
  if (cardCount != null) updates.cardCount = cardCount;
  if (qualityAvg !== undefined) updates.qualityAvg = qualityAvg;

  db.update(schema.personaStats).set(updates)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .run();

  const [updated] = db.select().from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .all();
  res.json(updated as PersonaStats);
});

export default router;
