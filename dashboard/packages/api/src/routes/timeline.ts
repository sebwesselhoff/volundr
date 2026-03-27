import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, isNotNull, gte, lte, SQL } from 'drizzle-orm';
import type { TimelineEntry } from '@vldr/shared';

const router = Router();

// GET /projects/:projectId/timeline — merged timeline of events, agent lifecycles, card transitions, quality scores
router.get('/projects/:projectId/timeline', (req, res) => {
  const db = getDb();
  const { projectId } = req.params;
  const { limit: limitStr, from, to, types, cardId } = req.query as {
    limit?: string;
    from?: string;
    to?: string;
    types?: string;
    cardId?: string;
  };

  const limit = Math.min(parseInt(limitStr ?? '200', 10) || 200, 500);

  // 1. Query events for the project
  const eventConditions: SQL[] = [eq(schema.events.projectId, projectId)];
  const eventRows = db.select()
    .from(schema.events)
    .where(and(...eventConditions))
    .all();

  const eventEntries: TimelineEntry[] = eventRows.map(e => ({
    kind: 'event' as const,
    timestamp: e.timestamp,
    type: e.type,
    title: e.type,
    detail: e.detail ?? '',
    cardId: e.cardId ?? null,
    costEstimate: e.costEstimate ?? null,
  }));

  // 2. Query completed agents for the project
  const agentRows = db.select()
    .from(schema.agents)
    .where(and(
      eq(schema.agents.projectId, projectId),
      isNotNull(schema.agents.completedAt),
    ))
    .all();

  const agentEntries: TimelineEntry[] = agentRows.map(a => ({
    kind: 'agent_lifecycle' as const,
    agentId: a.id,
    agentType: a.type,
    model: a.model,
    startedAt: a.startedAt,
    completedAt: a.completedAt!,
    durationMs: Date.parse(a.completedAt!) - Date.parse(a.startedAt),
    cardId: a.cardId ?? null,
  }));

  // 3. card_transition: filter events where type = 'card_status_changed'
  const cardTransitionEntries: TimelineEntry[] = eventRows
    .filter(e => e.type === 'card_status_changed' && e.cardId != null)
    .map(e => {
      let fromStatus = '';
      let toStatus = '';
      if (e.detail) {
        const fromMatch = e.detail.match(/from[:\s]+(\S+)/i);
        const toMatch = e.detail.match(/to[:\s]+(\S+)/i);
        if (fromMatch) fromStatus = fromMatch[1];
        if (toMatch) toStatus = toMatch[1];
      }
      return {
        kind: 'card_transition' as const,
        cardId: e.cardId!,
        fromStatus,
        toStatus,
        timestamp: e.timestamp,
      };
    });

  // 4. Query quality_scores via JOIN with cards
  const qualityRows = db.select({
    id: schema.qualityScores.id,
    cardId: schema.qualityScores.cardId,
    weightedScore: schema.qualityScores.weightedScore,
    createdAt: schema.qualityScores.createdAt,
  })
    .from(schema.qualityScores)
    .innerJoin(schema.cards, eq(schema.qualityScores.cardId, schema.cards.id))
    .where(eq(schema.cards.projectId, projectId))
    .all();

  const qualityEntries: TimelineEntry[] = qualityRows.map(qs => ({
    kind: 'quality_score' as const,
    cardId: qs.cardId,
    weightedScore: qs.weightedScore ?? 0,
    timestamp: qs.createdAt,
  }));

  // 5. Merge and sort by timestamp DESC
  let merged: TimelineEntry[] = [
    ...eventEntries,
    ...agentEntries,
    ...cardTransitionEntries,
    ...qualityEntries,
  ].sort((a, b) => {
    const tsA = 'timestamp' in a ? a.timestamp : ('startedAt' in a ? a.startedAt : '');
    const tsB = 'timestamp' in b ? b.timestamp : ('startedAt' in b ? b.startedAt : '');
    return tsB.localeCompare(tsA);
  });

  // 6. Apply filters
  const typeFilter = types ? types.split(',').map(t => t.trim()).filter(Boolean) : null;
  if (typeFilter && typeFilter.length > 0) {
    merged = merged.filter(entry => typeFilter.includes(entry.kind));
  }
  if (cardId) {
    merged = merged.filter(entry => {
      if ('cardId' in entry) return (entry as { cardId: string | null }).cardId === cardId;
      return false;
    });
  }
  if (from) {
    merged = merged.filter(entry => {
      const ts = 'timestamp' in entry ? (entry as { timestamp: string }).timestamp
        : 'startedAt' in entry ? (entry as { startedAt: string }).startedAt
        : '';
      return ts >= from;
    });
  }
  if (to) {
    merged = merged.filter(entry => {
      const ts = 'timestamp' in entry ? (entry as { timestamp: string }).timestamp
        : 'startedAt' in entry ? (entry as { startedAt: string }).startedAt
        : '';
      return ts <= to;
    });
  }

  // 7. Apply limit
  res.json(merged.slice(0, limit));
});

export default router;
