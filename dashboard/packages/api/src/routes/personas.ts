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
import { compileCharter } from '../lib/compile-charter.js';
import { discoverPersonas, PERSONA_SEEDS } from '../lib/discover-personas.js';
import { extractSkillsFromHistory } from '../lib/extract-skills.js';

const router = Router();

// ---- Personas -----------------------------------------------------------------

// GET /personas — list all personas (optional ?status= filter)
router.get('/personas', (req, res) => {
  const db = getDb();
  const { status } = req.query as { status?: string };
  let rows = db.select().from(schema.personas).all();
  if (status) rows = rows.filter((p) => p.status === status);
  res.json(rows);
});

// GET /personas/alumni — list retired personas (must be before /:id)
router.get('/personas/alumni', (_req, res) => {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.status, 'retired'))
    .all();
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
  const { id, name, role, expertise: rawExpertise, style, modelPreference, source } = req.body as {
    id?: string;
    name?: string;
    role?: string;
    expertise?: string | string[];
    style?: string;
    modelPreference?: string;
    source?: string;
  };
  if (!id || !name || !role || !rawExpertise) {
    throw new ApiError(400, 'id, name, role, and expertise are required');
  }
  const expertise = Array.isArray(rawExpertise) ? rawExpertise.join(', ') : rawExpertise;

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

// PATCH /personas/:id — partial update of persona fields
router.patch('/personas/:id', (req, res) => {
  const db = getDb();
  const [existing] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, req.params.id))
    .all();
  if (!existing) throw new ApiError(404, 'Persona not found');

  const { name, role, expertise: rawExpertise, style, modelPreference, status } = req.body as {
    name?: string;
    role?: string;
    expertise?: string | string[];
    style?: string;
    modelPreference?: string;
    status?: string;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (name != null) updates.name = name;
  if (role != null) updates.role = role;
  if (rawExpertise != null) updates.expertise = Array.isArray(rawExpertise) ? rawExpertise.join(', ') : rawExpertise;
  if (style != null) updates.style = style;
  if (modelPreference != null) updates.modelPreference = modelPreference;
  if (status != null) updates.status = status;

  db.update(schema.personas).set(updates).where(eq(schema.personas.id, req.params.id)).run();

  const [updated] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, req.params.id))
    .all();
  res.json(updated);
});

// DELETE /personas/:id — delete a persona (persona_history cascade-deleted automatically)
router.delete('/personas/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');

  db.delete(schema.personas)
    .where(eq(schema.personas.id, id))
    .run();

  res.status(204).send();
});

// ---- Persona Retirement Lifecycle --------------------------------------------

/**
 * POST /personas/:id/retire
 *
 * Retire a persona.  Sets status = 'retired', records retiredAt timestamp,
 * and stores an alumni summary computed from their stats and top history entries.
 *
 * Body:
 *   reason — string (optional) retirement reason appended to summary
 */
router.post('/personas/:id/retire', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');
  if (persona.status === 'retired') throw new ApiError(409, 'Persona is already retired');

  const { reason } = req.body as { reason?: string };

  // Build alumni summary from stats + top history entries
  const [stats] = db
    .select()
    .from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, id))
    .all();

  const topEntries = db
    .select()
    .from(schema.personaHistory)
    .where(
      and(
        eq(schema.personaHistory.personaId, id),
        eq(schema.personaHistory.archived, false),
      ),
    )
    .orderBy(desc(schema.personaHistory.confidence))
    .all()
    .slice(0, 5);

  const qualityStr = stats?.qualityAvg != null ? stats.qualityAvg.toFixed(1) : '—';
  const cardsStr = stats?.cardsCount ?? 0;
  const projectsStr = stats?.projectsCount ?? 0;

  const summaryLines = [
    `${persona.name} (${persona.role}) — retired ${new Date().toISOString().slice(0, 10)}`,
    `Projects: ${projectsStr} | Cards completed: ${cardsStr} | Avg quality: ${qualityStr}`,
    '',
    'Top learnings:',
    ...topEntries.map((e) => `- ${e.content.slice(0, 120)}`),
    ...(reason ? [`\nRetirement reason: ${reason}`] : []),
  ];

  const alumniSummary = summaryLines.join('\n');
  const now = new Date().toISOString();

  db.update(schema.personas)
    .set({ status: 'retired', retiredAt: now, alumniSummary, updatedAt: now })
    .where(eq(schema.personas.id, id))
    .run();

  const [updated] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();

  res.json(updated);
});

/**
 * POST /personas/:id/reactivate
 *
 * Bring a retired persona back to active status.
 * Clears retiredAt; alumniSummary is preserved as historical record.
 */
router.post('/personas/:id/reactivate', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');
  if (persona.status !== 'retired') throw new ApiError(409, 'Only retired personas can be reactivated');

  const now = new Date().toISOString();

  db.update(schema.personas)
    .set({ status: 'active', retiredAt: null, updatedAt: now })
    .where(eq(schema.personas.id, id))
    .run();

  const [updated] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();

  res.json(updated);
});

// ---- Persona Discovery --------------------------------------------------------

/**
 * POST /personas/discover
 *
 * Score all persona seeds against a list of tech stack signals and return
 * ranked recommendations.  Does NOT create any DB records — caller decides
 * which personas to activate based on the results.
 *
 * Body:
 *   stackSignals  — string[]  (required) tech stack terms e.g. ["typescript", "docker"]
 *   limit         — number    (optional, default 5)
 *   roleFilter    — string    (optional) filter by persona role
 */
router.post('/personas/discover', (req, res) => {
  const { stackSignals, limit, roleFilter } = req.body as {
    stackSignals?: string[];
    limit?: number;
    roleFilter?: string;
  };

  if (!Array.isArray(stackSignals) || stackSignals.length === 0) {
    throw new ApiError(400, 'stackSignals must be a non-empty string array');
  }

  // Merge with any custom personas in the DB (personas with source = 'user')
  const db = getDb();
  const dbPersonas = db.select().from(schema.personas).all();
  const customSeeds = dbPersonas
    .filter((p) => p.source === 'user')
    .map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      expertiseKeywords: p.expertise
        ? p.expertise.split(',').map((e: string) => e.trim().toLowerCase())
        : [],
    }));

  const allSeeds = [...PERSONA_SEEDS, ...customSeeds];

  const results = discoverPersonas({ stackSignals, limit, roleFilter }, allSeeds);

  res.json({ stackSignals, results });
});

// ---- Persona History ----------------------------------------------------------

// GET /personas/:id/history — list active history entries (with optional stack filter)
router.get('/personas/:id/history', (req, res) => {
  const db = getDb();
  const { stack, includeArchived, section } = req.query as {
    stack?: string;
    includeArchived?: string;
    section?: string; // alias for entryType filter (learning|decision|pattern|core_context)
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

  // Filter by entry type if requested (section is an alias for entryType)
  const byType = section
    ? parsed.filter((e) => e.entryType === section)
    : parsed;

  // Filter by stack tag if requested
  const filtered = stack
    ? byType.filter((e) => e.stackTags.includes(stack.toLowerCase()))
    : byType;

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

// ---- Learning Extraction (History → Skills Pipeline) -------------------------

/**
 * POST /personas/:id/extract-skills
 *
 * Runs the history-to-skills extraction pipeline for a persona.
 * Eligible high-confidence learning/pattern entries are grouped by stack tag
 * and promoted into skill records in the DB.
 *
 * Body:
 *   confidenceThreshold — number (optional, default 0.5)
 *   limit               — number (optional, default 10 per run)
 *   dryRun              — boolean (optional, default false) — if true, returns
 *                         what would be created without writing to DB
 */
router.post('/personas/:id/extract-skills', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');

  const { confidenceThreshold, limit, dryRun = false } = (req.body ?? {}) as {
    confidenceThreshold?: number;
    limit?: number;
    dryRun?: boolean;
  };

  // Load active history entries
  const historyRows = db
    .select()
    .from(schema.personaHistory)
    .where(
      and(
        eq(schema.personaHistory.personaId, id),
        eq(schema.personaHistory.archived, false),
      ),
    )
    .all();

  const entries = historyRows.map((r) => ({
    id: r.id,
    personaId: r.personaId,
    entryType: r.entryType,
    content: r.content,
    projectId: r.projectId ?? null,
    projectName: r.projectName ?? null,
    stackTags: parseStackTags(r.stackTags),
    confidence: decayedConfidence(r.confidence ?? 1.0, r.lastReinforcedAt),
    createdAt: r.createdAt,
  }));

  const { skills, includedEntryIds } = extractSkillsFromHistory({
    personaId: id,
    personaRole: persona.role,
    entries,
    confidenceThreshold,
    limit,
  });

  if (dryRun) {
    return res.json({ dryRun: true, skills, includedEntryCount: includedEntryIds.length });
  }

  // Upsert extracted skills into DB
  const now = new Date().toISOString();
  const upserted: string[] = [];
  const updated: string[] = [];

  for (const skill of skills) {
    // Check if skill already exists
    const [existing] = db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skill.id))
      .all();

    if (existing) {
      // Update version and body
      db.update(schema.skills)
        .set({
          body: skill.body ?? '',
          version: (existing.version ?? 1) + 1,
          confidence: skill.confidence ?? 'medium',
          updatedAt: now,
        })
        .where(eq(schema.skills.id, skill.id))
        .run();
      updated.push(skill.id);
    } else {
      db.insert(schema.skills)
        .values({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          domain: skill.domain,
          confidence: skill.confidence ?? 'medium',
          source: 'extracted',
          version: 1,
          validatedAt: skill.validatedAt ?? now.slice(0, 10),
          reviewByDate: skill.reviewByDate ?? now.slice(0, 10),
          triggers: JSON.stringify(skill.triggers ?? []),
          roles: JSON.stringify(skill.roles ?? []),
          body: skill.body ?? '',
          updatedAt: now,
        })
        .run();
      upserted.push(skill.id);
    }
  }

  res.json({
    personaId: id,
    created: upserted,
    updated,
    includedEntryCount: includedEntryIds.length,
    totalSkillsProcessed: skills.length,
  });
});

// ---- Charter Compile ----------------------------------------------------------

/**
 * POST /personas/:id/compile
 *
 * Runs the 8-layer charter compiler for a persona and returns the compiled
 * system prompt.  Called at spawn time to build the agent's initial context.
 *
 * Body (all optional):
 *   charterMd     — override the persona's charter text (defaults to persona.charterPath content or '')
 *   constraintsMd — project constraints.md text
 *   cardContext   — current card spec text
 *   traits        — string[] of trait names to inject
 *   cardStackTags — string[] of stack tags for relevance sorting
 *   projectId     — project id for scoped directive + history lookup
 */
router.post('/personas/:id/compile', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const [persona] = db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, id))
    .all();
  if (!persona) throw new ApiError(404, 'Persona not found');

  const {
    charterMd,
    constraintsMd = '',
    cardContext = '',
    traits = [],
    cardStackTags,
    projectId,
  } = req.body as {
    charterMd?: string;
    constraintsMd?: string;
    cardContext?: string;
    traits?: string[];
    cardStackTags?: string[];
    projectId?: string;
  };

  // Load active history for this persona
  const historyRows = db
    .select()
    .from(schema.personaHistory)
    .where(
      and(
        eq(schema.personaHistory.personaId, id),
        eq(schema.personaHistory.archived, false),
      ),
    )
    .orderBy(desc(schema.personaHistory.createdAt))
    .all();

  const historyEntries = historyRows.map((r) => ({
    id: r.id,
    entryType: r.entryType,
    content: r.content,
    projectId: r.projectId ?? null,
    projectName: r.projectName ?? null,
    stackTags: parseStackTags(r.stackTags),
    confidence: decayedConfidence(r.confidence ?? 1.0, r.lastReinforcedAt),
    createdAt: r.createdAt,
  }));

  // Load stats
  const [statsRow] = db
    .select()
    .from(schema.personaStats)
    .where(eq(schema.personaStats.personaId, id))
    .all();

  const stats = {
    projectsCount: statsRow?.projectsCount ?? 0,
    cardsCount: statsRow?.cardsCount ?? 0,
    qualityAvg: statsRow?.qualityAvg ?? null,
  };

  // Load active directives — global + project-scoped (if projectId given)
  const allDirectives = db
    .select()
    .from(schema.directives)
    .where(eq(schema.directives.status, 'active'))
    .all();

  const directives = allDirectives
    .filter((d) => d.projectId == null || d.projectId === (projectId ?? null))
    .map((d) => ({
      id: d.id,
      content: d.content,
      projectId: d.projectId ?? null,
      priority: d.priority,
    }));

  // Load skills assigned to this persona via persona_skills join or all skills filtered by role
  // Skills table doesn't have a persona_id yet — use all skills with matching role filter
  const allSkills = db.select().from(schema.skills).all();
  const roleSkills = allSkills
    .filter((s) => {
      const roles: string[] = JSON.parse(s.roles ?? '[]');
      return roles.length === 0 || roles.includes(persona.role);
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      domain: s.domain,
      confidence: (s.confidence ?? 'medium') as 'low' | 'medium' | 'high',
      body: s.body ?? '',
    }));

  const compiled = compileCharter({
    charterMd: charterMd ?? '',
    constraintsMd,
    directives,
    skills: roleSkills,
    historyEntries,
    stats,
    cardContext,
    traits,
    cardStackTags,
  });

  res.json({ personaId: id, compiled, layerStats: { historyEntries: historyEntries.length, skills: roleSkills.length, directives: directives.length } });
});

export default router;
