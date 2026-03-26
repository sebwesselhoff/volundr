import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, desc } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import {
  parseStackTags,
  serialiseStackTags,
  extractStackTags,
  decayedConfidence,
  shouldArchive,
  type HistoryEntryType,
} from '../lib/persona-history.js';

const router = Router();

// ---- Personas -----------------------------------------------------------------

// GET /personas — list all personas
router.get('/personas', (_req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.personas).all();
  res.json(rows);
});

// GET /personas/:id — get a single persona with stats
router.get('/personas/:id', (req, res) => {
  const db = getDb();
  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, req.params.id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');

  const [stats] = db
    .select()
    .from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .all();

  res.json({ ...persona, stats: stats ?? null });
});

// POST /personas — create or upsert a persona
router.post('/personas', (req, res) => {
  const { id, name, role, expertise, style, modelPreference, source } = req.body as {
    id?: string;
    name?: string;
    role?: string;
    expertise?: string;
    style?: string;
    modelPreference?: string;
    source?: string;
  };
  if (!id || !name || !role || !expertise) {
    throw new ApiError(400, 'id, name, role, and expertise are required');
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.personas)
    .values({
      id,
      name,
      role,
      expertise,
      style: style ?? '',
      modelPreference: modelPreference ?? 'auto',
      source: source ?? 'user',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.personas.id,
      set: {
        name,
        role,
        expertise,
        ...(style != null ? { style } : {}),
        ...(modelPreference != null ? { modelPreference } : {}),
        updatedAt: now,
      },
    })
    .run();

  const [created] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  res.status(201).json(created);
});

// ---- Persona History ----------------------------------------------------------

// GET /personas/:id/history — list active history entries (with optional stack filter)
router.get('/personas/:id/history', (req, res) => {
  const db = getDb();
  const { stack, includeArchived } = req.query as {
    stack?: string;
    includeArchived?: string;
  };

  const showArchived = includeArchived === 'true';

  let rows = db
    .select()
    .from(schema.personaHistory)
    .where(
      showArchived
        ? eq(schema.personaHistory.personaId, req.params.id)
        : and(
            eq(schema.personaHistory.personaId, req.params.id),
            eq(schema.personaHistory.archived, false),
          ),
    )
    .orderBy(desc(schema.personaHistory.createdAt))
    .all();

  // Deserialise stack_tags
  const parsed = rows.map((r) => ({
    ...r,
    stackTags: parseStackTags(r.stackTags),
    confidence: decayedConfidence(r.confidence ?? 1.0, r.lastReinforcedAt),
  }));

  // Filter by stack tag if requested
  const filtered = stack
    ? parsed.filter((e) => e.stackTags.includes(stack.toLowerCase()))
    : parsed;

  res.json(filtered);
});

// POST /personas/:id/history — add a history entry
router.post('/personas/:id/history', (req, res) => {
  const { entryType, content, projectId, projectName, cardId, stackTags } = req.body as {
    entryType?: string;
    content?: string;
    projectId?: string;
    projectName?: string;
    cardId?: string;
    stackTags?: string[];
  };

  if (!entryType || !content) {
    throw new ApiError(400, 'entryType and content are required');
  }

  const validTypes: HistoryEntryType[] = ['learning', 'decision', 'pattern', 'core_context'];
  if (!validTypes.includes(entryType as HistoryEntryType)) {
    throw new ApiError(400, `entryType must be one of: ${validTypes.join(', ')}`);
  }

  // Auto-extract stack tags from content if not provided
  const tags = stackTags ?? extractStackTags(content);

  const db = getDb();
  const result = db
    .insert(schema.personaHistory)
    .values({
      personaId: req.params.id,
      entryType,
      content,
      projectId: projectId ?? null,
      projectName: projectName ?? null,
      cardId: cardId ?? null,
      stackTags: serialiseStackTags(tags),
      confidence: 1.0,
    })
    .run();

  const [created] = db
    .select()
    .from(schema.personaHistory)
    .where(eq(schema.personaHistory.id, Number(result.lastInsertRowid)))
    .all();

  res.status(201).json({ ...created, stackTags: parseStackTags(created.stackTags) });
});

// POST /personas/:id/history/:entryId/reinforce — reset confidence to 1.0
router.post('/personas/:id/history/:entryId/reinforce', (req, res) => {
  const db = getDb();
  const entryId = Number(req.params.entryId);
  if (isNaN(entryId)) throw new ApiError(400, 'Invalid entry id');

  db.update(schema.personaHistory)
    .set({ confidence: 1.0, lastReinforcedAt: new Date().toISOString(), archived: false })
    .where(
      and(
        eq(schema.personaHistory.id, entryId),
        eq(schema.personaHistory.personaId, req.params.id),
      ),
    )
    .run();

  const [updated] = db
    .select()
    .from(schema.personaHistory)
    .where(eq(schema.personaHistory.id, entryId))
    .all();
  if (!updated) throw new ApiError(404, 'History entry not found');

  res.json({ ...updated, stackTags: parseStackTags(updated.stackTags) });
});

// POST /personas/:id/history/decay — run decay + archival sweep for a persona
router.post('/personas/:id/history/decay', (req, res) => {
  const db = getDb();

  const activeEntries = db
    .select()
    .from(schema.personaHistory)
    .where(
      and(
        eq(schema.personaHistory.personaId, req.params.id),
        eq(schema.personaHistory.archived, false),
      ),
    )
    .all();

  let archivedCount = 0;
  const now = new Date().toISOString();

  for (const entry of activeEntries) {
    const current = decayedConfidence(entry.confidence ?? 1.0, entry.lastReinforcedAt);
    if (shouldArchive({ confidence: entry.confidence ?? 1.0, lastReinforcedAt: entry.lastReinforcedAt })) {
      db.update(schema.personaHistory)
        .set({ confidence: current, archived: true, lastReinforcedAt: now })
        .where(eq(schema.personaHistory.id, entry.id))
        .run();
      archivedCount++;
    } else {
      // Persist the decayed value so reads are cheap
      db.update(schema.personaHistory)
        .set({ confidence: current })
        .where(eq(schema.personaHistory.id, entry.id))
        .run();
    }
  }

  res.json({ swept: activeEntries.length, archived: archivedCount });
});

// ---- Persona Stats ------------------------------------------------------------

// PUT /personas/:id/stats — upsert stats after a card completes
router.put('/personas/:id/stats', (req, res) => {
  const { projectsCount, cardsCount, qualityAvg, lastActiveAt } = req.body as {
    projectsCount?: number;
    cardsCount?: number;
    qualityAvg?: number;
    lastActiveAt?: string;
  };

  const db = getDb();
  const now = new Date().toISOString();

  db.insert(schema.personaStats)
    .values({
      personaId: req.params.id,
      projectsCount: projectsCount ?? 0,
      cardsCount: cardsCount ?? 0,
      qualityAvg: qualityAvg ?? null,
      lastActiveAt: lastActiveAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.personaStats.personaId,
      set: {
        ...(projectsCount != null ? { projectsCount } : {}),
        ...(cardsCount != null ? { cardsCount } : {}),
        ...(qualityAvg != null ? { qualityAvg } : {}),
        ...(lastActiveAt != null ? { lastActiveAt } : {}),
        updatedAt: now,
      },
    })
    .run();

  const [updated] = db
    .select()
    .from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, req.params.id))
    .all();

  res.json(updated);
});

export default router;
