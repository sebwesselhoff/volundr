/**
 * ceremonies.ts — API routes for the ceremony trigger system (GV-005)
 *
 * Routes:
 *   POST /projects/:projectId/ceremonies/evaluate  — evaluate ceremony triggers
 *   GET  /projects/:projectId/ceremonies/pending   — list pending ceremony commands
 *   POST /projects/:projectId/ceremonies/acknowledge — acknowledge a ceremony command
 */

import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { ApiError } from '../middleware/error-handler.js';

const router = Router();

// Inlined ceremony evaluation logic (mirrors framework/governance/ceremony-triggers.ts)
// to avoid cross-package TypeScript imports at runtime.

type CeremonyType =
  | 'sprint_review'
  | 'phase_transition'
  | 'optimization_cycle'
  | 'guardian_audit'
  | 'retrospective'
  | 'cost_warning';

interface CeremonyTrigger {
  type: CeremonyType;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  blocksExecution: boolean;
  context: Record<string, unknown>;
}

interface CeremonySnapshot {
  totalCards: number;
  completedCards: number;
  scoredCards: number;
  cardsSinceLastSprint: number;
  cardsSinceLastOptimization: number;
  phase: string;
  previousPhase: string | null;
  qualityAvg: number | null;
  currentCost: number;
  budgetCeiling: number | null;
  costWarningThreshold: number;
}

interface CeremonyConfig {
  sprintSize: number;
  qualityAuditThreshold: number;
  optimizationCycleInterval: number;
}

function evaluateCeremonies(
  snapshot: CeremonySnapshot,
  config: CeremonyConfig = { sprintSize: 5, qualityAuditThreshold: 3.0, optimizationCycleInterval: 5 },
): CeremonyTrigger[] {
  const triggers: CeremonyTrigger[] = [];

  if (snapshot.totalCards > 0 && snapshot.completedCards >= snapshot.totalCards) {
    return [{
      type: 'retrospective',
      reason: `All ${snapshot.totalCards} cards completed. Project retrospective required.`,
      severity: 'critical',
      blocksExecution: true,
      context: { totalCards: snapshot.totalCards, qualityAvg: snapshot.qualityAvg, currentCost: snapshot.currentCost },
    }];
  }

  if (snapshot.qualityAvg !== null && snapshot.scoredCards >= 3 && snapshot.qualityAvg < config.qualityAuditThreshold) {
    triggers.push({
      type: 'guardian_audit',
      reason: `Quality avg ${snapshot.qualityAvg.toFixed(2)} below threshold ${config.qualityAuditThreshold}.`,
      severity: 'critical',
      blocksExecution: true,
      context: { qualityAvg: snapshot.qualityAvg, threshold: config.qualityAuditThreshold, scoredCards: snapshot.scoredCards },
    });
  }

  if (snapshot.previousPhase !== null && snapshot.previousPhase !== snapshot.phase) {
    triggers.push({
      type: 'phase_transition',
      reason: `Phase changed from '${snapshot.previousPhase}' to '${snapshot.phase}'.`,
      severity: 'info',
      blocksExecution: false,
      context: { fromPhase: snapshot.previousPhase, toPhase: snapshot.phase },
    });
  }

  if (snapshot.cardsSinceLastSprint > 0 && snapshot.cardsSinceLastSprint % config.sprintSize === 0) {
    triggers.push({
      type: 'sprint_review',
      reason: `${snapshot.cardsSinceLastSprint} cards completed in sprint. Sprint review due.`,
      severity: 'warning',
      blocksExecution: false,
      context: { cardsInSprint: snapshot.cardsSinceLastSprint, sprintSize: config.sprintSize, completedTotal: snapshot.completedCards },
    });
  }

  if (snapshot.cardsSinceLastOptimization > 0 && snapshot.cardsSinceLastOptimization % config.optimizationCycleInterval === 0) {
    triggers.push({
      type: 'optimization_cycle',
      reason: `${snapshot.cardsSinceLastOptimization} cards since last optimization cycle.`,
      severity: 'info',
      blocksExecution: false,
      context: { cardsSinceLastOptimization: snapshot.cardsSinceLastOptimization, interval: config.optimizationCycleInterval },
    });
  }

  if (snapshot.budgetCeiling !== null && snapshot.currentCost >= snapshot.budgetCeiling * snapshot.costWarningThreshold) {
    const pct = Math.round((snapshot.currentCost / snapshot.budgetCeiling) * 100);
    triggers.push({
      type: 'cost_warning',
      reason: `Cost $${snapshot.currentCost.toFixed(2)} is ${pct}% of budget $${snapshot.budgetCeiling}.`,
      severity: snapshot.currentCost >= snapshot.budgetCeiling ? 'critical' : 'warning',
      blocksExecution: snapshot.currentCost >= snapshot.budgetCeiling,
      context: { currentCost: snapshot.currentCost, budgetCeiling: snapshot.budgetCeiling, pctUsed: pct },
    });
  }

  return triggers;
}

// POST /projects/:projectId/ceremonies/evaluate
// Builds a snapshot from DB state and evaluates which ceremonies should fire.
// Fires ceremony commands into the commands table for pending ceremonies.
router.post('/projects/:projectId/ceremonies/evaluate', (req, res) => {
  const { projectId } = req.params;
  const db = getDb();

  const [project] = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all();
  if (!project) throw new ApiError(404, `Project ${projectId} not found`);

  // Build snapshot from DB
  const allCards = db.select().from(schema.cards)
    .where(eq(schema.cards.projectId, projectId))
    .all();

  const completedCards = allCards.filter((c) => c.status === 'done').length;

  const scoredCardIds = db.select({ cardId: schema.qualityScores.cardId })
    .from(schema.qualityScores)
    .all()
    .map((r) => r.cardId);
  const projectCardIds = new Set(allCards.map((c) => c.id));
  const scoredInProject = scoredCardIds.filter((id) => projectCardIds.has(id));
  const scoredCards = scoredInProject.length;

  // Quality avg
  let qualityAvg: number | null = null;
  if (scoredCards > 0) {
    const scores = db.select({ w: schema.qualityScores.weightedScore })
      .from(schema.qualityScores)
      .all()
      .filter((s) => scoredInProject.includes(
        db.select({ cardId: schema.qualityScores.cardId })
          .from(schema.qualityScores)
          .where(eq(schema.qualityScores.weightedScore, s.w ?? 0))
          .all()[0]?.cardId ?? '',
      ));
    // Simpler approach: re-query with filter
    const allScores = db.select({ cardId: schema.qualityScores.cardId, w: schema.qualityScores.weightedScore })
      .from(schema.qualityScores)
      .all()
      .filter((s) => projectCardIds.has(s.cardId));
    if (allScores.length > 0) {
      const sum = allScores.reduce((acc, s) => acc + (s.w ?? 0), 0);
      qualityAvg = sum / allScores.length;
    }
  }

  // Cost from agents table
  const agentRows = db.select({ cost: schema.agents.estimatedCost })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all();
  const currentCost = agentRows.reduce((acc, a) => acc + (a.cost ?? 0), 0);

  // Count pending ceremony commands to detect last sprint/optimization
  const pendingCeremonies = db.select()
    .from(schema.commands)
    .where(and(
      eq(schema.commands.projectId, projectId),
      eq(schema.commands.status, 'pending'),
    ))
    .all()
    .filter((c) => c.type.startsWith('ceremony_'));

  const {
    previousPhase = null,
    sprintSize = 5,
    qualityAuditThreshold = 3.0,
    optimizationCycleInterval = 5,
    budgetCeiling = null,
    costWarningThreshold = 0.8,
    cardsSinceLastSprint = completedCards,
    cardsSinceLastOptimization = scoredCards,
  } = (req.body as Partial<{
    previousPhase: string | null;
    sprintSize: number;
    qualityAuditThreshold: number;
    optimizationCycleInterval: number;
    budgetCeiling: number | null;
    costWarningThreshold: number;
    cardsSinceLastSprint: number;
    cardsSinceLastOptimization: number;
  }>) ?? {};

  const snapshot: CeremonySnapshot = {
    totalCards: allCards.length,
    completedCards,
    scoredCards,
    cardsSinceLastSprint,
    cardsSinceLastOptimization,
    phase: project.phase,
    previousPhase,
    qualityAvg,
    currentCost,
    budgetCeiling,
    costWarningThreshold,
  };

  const config: CeremonyConfig = { sprintSize, qualityAuditThreshold, optimizationCycleInterval };

  const triggers = evaluateCeremonies(snapshot, config);

  // Persist fired triggers as commands
  const created: typeof schema.commands.$inferSelect[] = [];
  for (const trigger of triggers) {
    const commandType = `ceremony_${trigger.type}`;
    // Avoid duplicate pending ceremonies of the same type
    const alreadyPending = pendingCeremonies.some((c) => c.type === commandType);
    if (!alreadyPending) {
      const id = uuid();
      db.insert(schema.commands).values({
        id,
        projectId,
        type: commandType,
        detail: JSON.stringify({
          reason: trigger.reason,
          severity: trigger.severity,
          blocksExecution: trigger.blocksExecution,
          context: trigger.context,
        }),
        status: 'pending',
      }).run();

      const [cmd] = db.select().from(schema.commands)
        .where(eq(schema.commands.id, id))
        .all();
      if (cmd) created.push(cmd);
    }
  }

  res.json({
    snapshot,
    triggers,
    commandsCreated: created,
  });
});

// GET /projects/:projectId/ceremonies/pending — list pending ceremony commands
router.get('/projects/:projectId/ceremonies/pending', (req, res) => {
  const { projectId } = req.params;
  const db = getDb();

  const [project] = db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all();
  if (!project) throw new ApiError(404, `Project ${projectId} not found`);

  const pending = db.select()
    .from(schema.commands)
    .where(and(
      eq(schema.commands.projectId, projectId),
      eq(schema.commands.status, 'pending'),
    ))
    .all()
    .filter((c) => c.type.startsWith('ceremony_'));

  res.json(pending);
});

// POST /projects/:projectId/ceremonies/acknowledge — acknowledge a ceremony command
router.post('/projects/:projectId/ceremonies/acknowledge', (req, res) => {
  const { projectId } = req.params;
  const { commandId } = req.body as { commandId?: string };
  if (!commandId) throw new ApiError(400, 'commandId is required');

  const db = getDb();
  const [cmd] = db.select()
    .from(schema.commands)
    .where(and(
      eq(schema.commands.id, commandId),
      eq(schema.commands.projectId, projectId),
    ))
    .all();

  if (!cmd) throw new ApiError(404, `Command ${commandId} not found`);
  if (!cmd.type.startsWith('ceremony_')) {
    throw new ApiError(400, `Command ${commandId} is not a ceremony command`);
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  db.update(schema.commands)
    .set({ status: 'acknowledged', acknowledgedAt: now })
    .where(eq(schema.commands.id, commandId))
    .run();

  const [updated] = db.select()
    .from(schema.commands)
    .where(eq(schema.commands.id, commandId))
    .all();

  res.json(updated);
});

export default router;
