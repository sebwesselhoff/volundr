import { Router } from 'express';
import { getDb, getRawSqlite, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import type { Card } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';
import { validateDeps } from '../lib/dep-validation.js';
import { autoRouteCard, buildRoutingDescription } from '../lib/auto-routing.js';

const router = Router();

function parseCardJsonFields(card: typeof schema.cards.$inferSelect) {
  return {
    ...card,
    deps: card.deps ? JSON.parse(card.deps) : [],
    filesCreated: card.filesCreated ? JSON.parse(card.filesCreated) : [],
    filesModified: card.filesModified ? JSON.parse(card.filesModified) : [],
    isc: parseIsc(card.isc),
    assignedPersonaId: card.assignedPersonaId ?? null,
    routingConfidence: card.routingConfidence ?? null,
    routingReason: card.routingReason ?? null,
  };
}

function parseIsc(raw: string | null | undefined): any[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /projects/:projectId/cards — list cards (filter by epicId, status, priority)
router.get('/projects/:projectId/cards', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.cards).where(eq(schema.cards.projectId, req.params.projectId)).all();

  const { epicId, status, priority } = req.query as {
    epicId?: string;
    status?: string;
    priority?: string;
  };

  let filtered = rows;
  if (epicId) filtered = filtered.filter(c => c.epicId === epicId);
  if (status) filtered = filtered.filter(c => c.status === status);
  if (priority) filtered = filtered.filter(c => c.priority === priority);

  res.json(filtered.map(parseCardJsonFields));
});

// POST /projects/:projectId/cards — create card
router.post('/projects/:projectId/cards', (req, res) => {
  const {
    id, epicId, title, size, priority,
    description, status, deps, criteria, technicalNotes,
    filesCreated, filesModified, branch, isc,
  } = req.body as {
    id?: string;
    epicId?: string;
    title?: string;
    size?: string;
    priority?: string;
    description?: string;
    status?: string;
    deps?: string[];
    criteria?: string;
    technicalNotes?: string;
    filesCreated?: string[];
    filesModified?: string[];
    branch?: string;
    isc?: Array<{ criterion: string; evidence: string | null; passed: boolean | null }>;
  };

  if (!id || !epicId || !title || !size || !priority) {
    throw new ApiError(400, 'id, epicId, title, size, and priority are required');
  }

  const depsArr = deps ?? [];
  validateDeps(req.params.projectId, id, depsArr);

  // Auto-route: assign persona from routing rules
  let assignedPersonaId: string | null = null;
  let routingConfidence: string | null = null;
  let routingReason: string | null = null;
  try {
    const routingResult = autoRouteCard(getRawSqlite(), {
      description: buildRoutingDescription(title, description ?? ''),
    });
    assignedPersonaId = routingResult.personaId;
    routingConfidence = routingResult.confidence;
    routingReason = routingResult.reason;
  } catch {
    // Non-fatal: proceed without routing assignment
  }

  const db = getDb();
  db.insert(schema.cards).values({
    id,
    epicId,
    projectId: req.params.projectId,
    title,
    description: description ?? '',
    size,
    priority,
    ...(status ? { status } : {}),
    deps: JSON.stringify(depsArr),
    criteria: criteria ?? '',
    technicalNotes: technicalNotes ?? '',
    filesCreated: JSON.stringify(filesCreated ?? []),
    filesModified: JSON.stringify(filesModified ?? []),
    branch: branch ?? '',
    ...(isc ? { isc: JSON.stringify(isc) } : {}),
    assignedPersonaId,
    routingConfidence,
    routingReason,
  }).run();

  const [card] = db.select().from(schema.cards).where(eq(schema.cards.id, id)).all();
  const parsed = parseCardJsonFields(card);
  broadcastToAll({ type: 'card:updated', data: parsed as Card });
  res.status(201).json(parsed);
});

// GET /cards/:id — get single card by id
router.get('/cards/:id', (req, res) => {
  const db = getDb();
  const [card] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!card) throw new ApiError(404, `Card ${req.params.id} not found`);
  res.json(parseCardJsonFields(card));
});

// POST /cards/:id/checkout — atomic task checkout (prevents double-claiming)
router.post('/cards/:id/checkout', (req, res) => {
  const db = getDb();
  const [card] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (card.status === 'in_progress') {
    return res.status(409).json({
      error: 'Card already checked out',
      detail: `Card ${req.params.id} is already in_progress. Do not retry a 409.`,
    });
  }

  db.update(schema.cards)
    .set({ status: 'in_progress', updatedAt: new Date().toISOString() })
    .where(eq(schema.cards.id, req.params.id))
    .run();

  const [updated] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  const parsed = parseCardJsonFields(updated);
  broadcastToAll({ type: 'card:updated', data: parsed as Card });
  res.json(parsed);
});

// PATCH /cards/:id/isc — update ISC criteria (must be before /:id to avoid route conflict)
router.patch('/cards/:id/isc', (req, res) => {
  const db = getDb();
  const [card] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  if (req.body.isc) {
    db.update(schema.cards)
      .set({ isc: JSON.stringify(req.body.isc), updatedAt: now })
      .where(eq(schema.cards.id, req.params.id))
      .run();
    const [updated] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
    const parsed = parseCardJsonFields(updated);
    broadcastToAll({ type: 'card:updated', data: parsed as Card });
    return res.json(parsed);
  }

  if (req.body.index !== undefined) {
    const isc: any[] = card.isc ? (() => { try { return JSON.parse(card.isc!); } catch { return []; } })() : [];
    const idx = req.body.index;
    if (idx < 0 || idx >= isc.length) {
      return res.status(400).json({ error: `Index ${idx} out of range (0-${isc.length - 1})` });
    }
    if (req.body.evidence !== undefined) isc[idx].evidence = req.body.evidence;
    if (req.body.passed !== undefined) isc[idx].passed = req.body.passed;
    db.update(schema.cards)
      .set({ isc: JSON.stringify(isc), updatedAt: now })
      .where(eq(schema.cards.id, req.params.id))
      .run();
    const [updated] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
    const parsed = parseCardJsonFields(updated);
    broadcastToAll({ type: 'card:updated', data: parsed as Card });
    return res.json(parsed);
  }

  return res.status(400).json({ error: 'Provide either "isc" (full array) or "index" (single update)' });
});

// PATCH /cards/:id — update card
router.patch('/cards/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Card ${req.params.id} not found`);

  const {
    status, branch, priority, completedAt,
    filesCreated, filesModified, deps,
    epicId, title, description, size,
    criteria, technicalNotes, quality, isc,
  } = req.body as {
    status?: string;
    branch?: string;
    priority?: string;
    completedAt?: string;
    filesCreated?: string[];
    filesModified?: string[];
    deps?: string[];
    epicId?: string;
    title?: string;
    description?: string;
    size?: string;
    criteria?: string;
    technicalNotes?: string;
    isc?: Array<{ criterion: string; evidence: string | null; passed: boolean | null }>;
    quality?: {
      completeness: number;
      codeQuality: number;
      formatCompliance: number;
      correctness?: number;
      independence?: number; // backward compat → maps to correctness
      implementationType: string;
      reviewType?: string;
    };
  };

  if (status != null && status !== existing.status) {
    // Gate 1: deps must be done before in_progress
    if (status === 'in_progress') {
      const depsArr: string[] = existing.deps ? JSON.parse(existing.deps) : [];
      if (depsArr.length > 0) {
        const depCards = db.select({ id: schema.cards.id, status: schema.cards.status })
          .from(schema.cards)
          .all()
          .filter(c => depsArr.includes(c.id));
        const notDone = depCards.filter(c => c.status !== 'done');
        if (notDone.length > 0) {
          return res.status(409).json({
            error: 'Unresolved dependencies',
            detail: `Card ${req.params.id} cannot move to in_progress: ${notDone.length} dep(s) not done`,
            unresolved: notDone.map(c => c.id),
          });
        }
      }
    }

    // Gate 2: ISC criteria required before leaving backlog
    if (existing.status === 'backlog') {
      const isc2 = existing.isc ? (() => { try { return JSON.parse(existing.isc!); } catch { return []; } })() : [];
      if (isc2.length === 0) {
        throw new ApiError(400, `Card ${req.params.id} cannot leave backlog: ISC criteria are required before starting work`);
      }
    }

    // Gate 4: CARD-000 must be done before any other card starts
    if (status === 'in_progress' && !req.params.id.includes('000')) {
      const card000 = db.select({ id: schema.cards.id, status: schema.cards.status })
        .from(schema.cards)
        .where(eq(schema.cards.projectId, existing.projectId))
        .all()
        .find(c => c.id.includes('000') || c.id.endsWith('-000'));
      if (card000 && card000.status !== 'done') {
        return res.status(409).json({
          error: 'Setup card not done',
          detail: `Card ${card000.id} (setup/CARD-000) must be done before starting other cards. Current status: ${card000.status}`,
        });
      }
    }
  }

  // Enforce quality scoring when marking a card as done
  if (status === 'done' && existing.status !== 'done') {
    if (!quality) {
      throw new ApiError(400, 'Quality scoring required when marking card as done. Include a "quality" object with: completeness, codeQuality, formatCompliance, correctness, implementationType (each 1-10)');
    }
    // Accept either correctness or independence (backward compat)
    const effectiveCorrectness = quality.correctness ?? quality.independence;
    if (
      quality.completeness == null || quality.codeQuality == null ||
      quality.formatCompliance == null || effectiveCorrectness == null ||
      !quality.implementationType
    ) {
      throw new ApiError(400, 'Quality object must include: completeness, codeQuality, formatCompliance, correctness (1-10), and implementationType (agent|direct|human)');
    }
  }

  // Validate score ranges when quality is provided
  if (quality) {
    const SCORE_MIN = 1, SCORE_MAX = 10;
    for (const [key, val] of Object.entries({
      completeness: quality.completeness,
      codeQuality: quality.codeQuality,
      formatCompliance: quality.formatCompliance,
      independence: quality.independence,
    })) {
      if (val != null && (typeof val !== 'number' || val < SCORE_MIN || val > SCORE_MAX)) {
        throw new ApiError(400, `quality.${key} must be between ${SCORE_MIN} and ${SCORE_MAX}, got ${val}`);
      }
    }
  }

  // Enforce ISC gate when marking a card as done
  if (status === 'done' && existing.status !== 'done') {
    const isc = existing.isc ? (() => { try { return JSON.parse(existing.isc!); } catch { return []; } })() : [];
    if (isc.length > 0) {
      const unverified = isc.filter((c: any) => c.passed === null);
      if (unverified.length > 0) {
        return res.status(400).json({
          error: 'ISC criteria not fully verified',
          detail: `${unverified.length} of ${isc.length} criteria still pending`,
          unverified: unverified.map((c: any) => c.criterion),
        });
      }
    }
  }

  if (deps !== undefined) {
    validateDeps(existing.projectId, req.params.id, deps);
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const updates: Record<string, unknown> = { updatedAt: now };
  if (status != null) updates.status = status;
  if (branch != null) updates.branch = branch;
  if (priority != null) updates.priority = priority;
  if (completedAt != null) updates.completedAt = completedAt;
  if (status === 'done' && !completedAt) updates.completedAt = now;
  if (filesCreated !== undefined) updates.filesCreated = JSON.stringify(filesCreated);
  if (filesModified !== undefined) updates.filesModified = JSON.stringify(filesModified);
  if (deps !== undefined) updates.deps = JSON.stringify(deps);
  if (epicId != null) updates.epicId = epicId;
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (size != null) updates.size = size;
  if (criteria != null) updates.criteria = criteria;
  if (technicalNotes != null) updates.technicalNotes = technicalNotes;
  if (isc !== undefined) updates.isc = JSON.stringify(isc);

  db.update(schema.cards).set(updates).where(eq(schema.cards.id, req.params.id)).run();

  // Upsert quality score atomically when marking done
  if (quality && status === 'done') {
    const C = quality.completeness;
    const Q = quality.codeQuality;
    const F = quality.formatCompliance;
    const R = quality.correctness ?? quality.independence ?? 0;
    const weightedScore = (C * 3 + Q * 3 + F * 2 + R * 2) / 10;
    const reviewType = quality.reviewType ?? 'self';

    const [existingScore] = db.select().from(schema.qualityScores)
      .where(eq(schema.qualityScores.cardId, req.params.id)).all();

    if (existingScore) {
      db.update(schema.qualityScores).set({
        completeness: C, codeQuality: Q, formatCompliance: F, correctness: R,
        weightedScore, implementationType: quality.implementationType, reviewType, updatedAt: now,
      }).where(eq(schema.qualityScores.cardId, req.params.id)).run();
    } else {
      db.insert(schema.qualityScores).values({
        cardId: req.params.id,
        completeness: C, codeQuality: Q, formatCompliance: F, correctness: R,
        weightedScore, implementationType: quality.implementationType, reviewType,
      }).run();
    }
  }

  const [updated] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  const parsed = parseCardJsonFields(updated);
  broadcastToAll({ type: 'card:updated', data: parsed as Card });
  res.json(parsed);
});

// POST /cards/:id/route — re-run auto-routing for an existing card
router.post('/cards/:id/route', (req, res) => {
  const db = getDb();
  const [card] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!card) throw new ApiError(404, `Card ${req.params.id} not found`);

  const routingResult = autoRouteCard(getRawSqlite(), {
    description: buildRoutingDescription(card.title, card.description ?? ''),
  });

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  db.update(schema.cards).set({
    assignedPersonaId: routingResult.personaId,
    routingConfidence: routingResult.confidence,
    routingReason: routingResult.reason,
    updatedAt: now,
  }).where(eq(schema.cards.id, req.params.id)).run();

  const [updated] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  const parsed = parseCardJsonFields(updated);
  broadcastToAll({ type: 'card:updated', data: parsed as Card });
  res.json(parsed);
});

// DELETE /cards/:id — delete card
router.delete('/cards/:id', (req, res) => {
  const db = getDb();
  const [existing] = db.select().from(schema.cards).where(eq(schema.cards.id, req.params.id)).all();
  if (!existing) throw new ApiError(404, `Card ${req.params.id} not found`);
  if (existing.status === 'in_progress') throw new ApiError(400, 'Cannot delete a card that is in_progress');

  // Check no other cards depend on this one
  const allCards = db.select({ id: schema.cards.id, deps: schema.cards.deps })
    .from(schema.cards)
    .where(eq(schema.cards.projectId, existing.projectId))
    .all();

  const dependents = allCards.filter(c => {
    if (c.id === req.params.id) return false;
    const deps: string[] = c.deps ? JSON.parse(c.deps) : [];
    return deps.includes(req.params.id);
  });

  if (dependents.length > 0) {
    throw new ApiError(400, `Cannot delete card: ${dependents.map(c => c.id).join(', ')} depend(s) on it`);
  }

  db.delete(schema.cards).where(eq(schema.cards.id, req.params.id)).run();
  res.status(204).send();
});

export default router;
