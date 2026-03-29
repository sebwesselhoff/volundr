/**
 * reviewer-lockouts.ts — API routes for the reviewer lockout system (GV-004)
 *
 * A reviewer lockout prevents a persona from being assigned as reviewer on a
 * specific card — typically because they authored the work being reviewed.
 * The routing engine checks lockouts before assigning a reviewer persona.
 *
 * Routes:
 *   GET  /reviewer-lockouts                      — list all lockouts
 *   GET  /reviewer-lockouts/:cardId              — lockouts for a card
 *   POST /reviewer-lockouts                      — create a lockout
 *   DELETE /reviewer-lockouts/:cardId/:personaId — remove a lockout
 *   POST /reviewer-lockouts/check                — check if persona is locked for a card
 *   GET  /routing-rules/eligible-reviewers       — reviewers not locked out for a card
 */

import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import type { ReviewerLockout } from '@vldr/shared';

const router = Router();

// GET /reviewer-lockouts — list all lockouts
router.get('/reviewer-lockouts', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.reviewerLockouts).all();
  res.json(rows as ReviewerLockout[]);
});

// GET /reviewer-lockouts/:cardId — list lockouts for a specific card
router.get('/reviewer-lockouts/:cardId', (req, res) => {
  const db = getDb();
  const rows = db.select()
    .from(schema.reviewerLockouts)
    .where(eq(schema.reviewerLockouts.cardId, req.params.cardId))
    .all();
  res.json(rows as ReviewerLockout[]);
});

// POST /reviewer-lockouts — create a lockout
router.post('/reviewer-lockouts', (req, res) => {
  const { cardId, personaId, reason } = req.body as {
    cardId?: string;
    personaId?: string;
    reason?: string;
  };

  if (!cardId) throw new ApiError(400, 'cardId is required');
  if (!personaId) throw new ApiError(400, 'personaId is required');

  const db = getDb();

  // Check for existing lockout (composite PK - upsert behaviour)
  const [existing] = db.select()
    .from(schema.reviewerLockouts)
    .where(
      and(
        eq(schema.reviewerLockouts.cardId, cardId),
        eq(schema.reviewerLockouts.personaId, personaId),
      ),
    )
    .all();

  if (existing) {
    // Already locked - return existing record
    res.status(200).json(existing as ReviewerLockout);
    return;
  }

  db.insert(schema.reviewerLockouts).values({
    cardId,
    personaId,
    reason: reason ?? null,
  }).run();

  const [created] = db.select()
    .from(schema.reviewerLockouts)
    .where(
      and(
        eq(schema.reviewerLockouts.cardId, cardId),
        eq(schema.reviewerLockouts.personaId, personaId),
      ),
    )
    .all();

  res.status(201).json(created as ReviewerLockout);
});

// DELETE /reviewer-lockouts/:cardId/:personaId — remove a lockout
router.delete('/reviewer-lockouts/:cardId/:personaId', (req, res) => {
  const { cardId, personaId } = req.params;
  const db = getDb();

  const [existing] = db.select()
    .from(schema.reviewerLockouts)
    .where(
      and(
        eq(schema.reviewerLockouts.cardId, cardId),
        eq(schema.reviewerLockouts.personaId, personaId),
      ),
    )
    .all();

  if (!existing) {
    throw new ApiError(404, `Lockout for card ${cardId} / persona ${personaId} not found`);
  }

  db.delete(schema.reviewerLockouts)
    .where(
      and(
        eq(schema.reviewerLockouts.cardId, cardId),
        eq(schema.reviewerLockouts.personaId, personaId),
      ),
    )
    .run();

  res.status(204).send();
});

// POST /reviewer-lockouts/check — check if a persona is locked for a card
router.post('/reviewer-lockouts/check', (req, res) => {
  const { cardId, personaId } = req.body as {
    cardId?: string;
    personaId?: string;
  };

  if (!cardId) throw new ApiError(400, 'cardId is required');
  if (!personaId) throw new ApiError(400, 'personaId is required');

  const db = getDb();
  const [lockout] = db.select()
    .from(schema.reviewerLockouts)
    .where(
      and(
        eq(schema.reviewerLockouts.cardId, cardId),
        eq(schema.reviewerLockouts.personaId, personaId),
      ),
    )
    .all();

  res.json({
    cardId,
    personaId,
    locked: lockout != null,
    lockout: lockout ?? null,
  });
});

// GET /reviewer-lockouts/eligible-reviewers/:cardId — personas not locked for a card
// Accepts ?role= query param to filter by role (e.g. ?role=reviewer)
router.get('/reviewer-lockouts/eligible-reviewers/:cardId', (req, res) => {
  const { cardId } = req.params;
  const db = getDb();

  // Get all locked persona IDs for this card
  const lockouts = db.select({ personaId: schema.reviewerLockouts.personaId })
    .from(schema.reviewerLockouts)
    .where(eq(schema.reviewerLockouts.cardId, cardId))
    .all();

  const lockedIds = new Set(lockouts.map((l) => l.personaId));

  // Fetch all personas, filter out locked ones
  let personas = db.select().from(schema.personas).all();

  const { role } = req.query as { role?: string };
  if (role) {
    personas = personas.filter((p) => p.role === role);
  }

  const eligible = personas.filter((p) => !lockedIds.has(p.id));

  res.json({
    cardId,
    lockedPersonaIds: [...lockedIds],
    eligible,
  });
});

export default router;
