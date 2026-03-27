import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, isNotNull, gte, lte, SQL } from 'drizzle-orm';
import type { TimelineEntry } from '@vldr/shared';

const router = Router();

/**
 * Parse "from → to" status from a card_status_changed event detail string.
 * Tries JSON first (e.g. {"from":"backlog","to":"in_progress"}), then falls
 * back to loose regex so we handle both structured and legacy freeform strings.
 */
function parseStatusChange(detail: string | null | undefined): { fromStatus: string; toStatus: string } {
  if (!detail) return { fromStatus: '', toStatus: '' };

  // Try JSON first
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const from = typeof parsed.from === 'string' ? parsed.from
      : typeof parsed.fromStatus === 'string' ? parsed.fromStatus : '';
    const to = typeof parsed.to === 'string' ? parsed.to
      : typeof parsed.toStatus === 'string' ? parsed.toStatus : '';
    if (from || to) return { fromStatus: from, toStatus: to };
  } catch {
    // fall through to regex
  }

  // Regex fallback: "from: backlog to: in_progress" or "backlog → in_progress"
  const arrowMatch = detail.match(/(\S+)\s*[→>-]+\s*(\S+)/);
  if (arrowMatch) return { fromStatus: arrowMatch[1], toStatus: arrowMatch[2] };

  const fromMatch = detail.match(/\bfrom[:\s]+(\S+)/i);
  const toMatch = detail.match(/\bto[:\s]+(\S+)/i);
  return {
    fromStatus: fromMatch ? fromMatch[1] : '',
    toStatus: toMatch ? toMatch[1] : '',
  };
}

/**
 * Extract the effective timestamp from any TimelineEntry for sorting purposes.
 * agent_lifecycle entries use startedAt; everything else has a timestamp field.
 */
function entryTimestamp(entry: TimelineEntry): string {
  if (entry.kind === 'agent_lifecycle') return entry.startedAt;
  return entry.timestamp;
}

// GET /projects/:projectId/timeline — merged timeline of events, agent lifecycles,
// card transitions, and quality scores.
//
// Query params:
//   limit  — max entries to return (default 200, max 500)
//   offset — skip N entries for pagination (default 0)
//   from   — ISO timestamp lower bound (inclusive)
//   to     — ISO timestamp upper bound (inclusive)
//   types  — comma-separated list of kinds to include (event, agent_lifecycle,
//             card_transition, quality_score)
//   cardId — restrict all entry types to a specific card
router.get('/projects/:projectId/timeline', (req, res) => {
  const db = getDb();
  const { projectId } = req.params;
  const { limit: limitStr, offset: offsetStr, from, to, types, cardId } = req.query as {
    limit?: string;
    offset?: string;
    from?: string;
    to?: string;
    types?: string;
    cardId?: string;
  };

  const limit = Math.min(parseInt(limitStr ?? '200', 10) || 200, 500);
  const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);

  const typeFilter = types ? types.split(',').map(t => t.trim()).filter(Boolean) : null;
  const wantKind = (kind: string) => !typeFilter || typeFilter.includes(kind);

  // -------------------------------------------------------------------------
  // 1. Events — push from/to/cardId filters to the DB
  //    card_status_changed events are intentionally EXCLUDED here: they are
  //    re-emitted as richer `card_transition` entries below so consumers don't
  //    see duplicates in the merged feed.
  // -------------------------------------------------------------------------
  let eventEntries: TimelineEntry[] = [];
  let rawStatusEvents: typeof schema.events.$inferSelect[] = [];

  if (wantKind('event') || wantKind('card_transition')) {
    const eventConditions: SQL[] = [eq(schema.events.projectId, projectId)];
    if (from) eventConditions.push(gte(schema.events.timestamp, from));
    if (to) eventConditions.push(lte(schema.events.timestamp, to));
    if (cardId) eventConditions.push(eq(schema.events.cardId, cardId));

    const eventRows = db.select()
      .from(schema.events)
      .where(and(...eventConditions))
      .all();

    // Partition: status-change events become card_transition entries; the rest become event entries.
    const nonStatusRows = eventRows.filter(e => e.type !== 'card_status_changed');
    rawStatusEvents = eventRows.filter(e => e.type === 'card_status_changed' && e.cardId != null);

    if (wantKind('event')) {
      eventEntries = nonStatusRows.map(e => ({
        kind: 'event' as const,
        timestamp: e.timestamp,
        type: e.type,
        // Produce a human-readable title by converting snake_case to Title Case.
        title: e.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        detail: e.detail ?? '',
        cardId: e.cardId ?? null,
        agentId: e.agentId ?? null,
        costEstimate: e.costEstimate ?? null,
      }));
    }
  }

  // -------------------------------------------------------------------------
  // 2. Agent lifecycles — include both running AND completed agents so callers
  //    can see in-flight work. completedAt/durationMs are null while running.
  // -------------------------------------------------------------------------
  let agentEntries: TimelineEntry[] = [];

  if (wantKind('agent_lifecycle')) {
    const agentConditions: SQL[] = [eq(schema.agents.projectId, projectId)];
    if (cardId) agentConditions.push(eq(schema.agents.cardId, cardId));
    // Note: no from/to push here — agents span a range; we filter by startedAt below.

    const agentRows = db.select()
      .from(schema.agents)
      .where(and(...agentConditions))
      .all();

    agentEntries = agentRows
      .filter(a => {
        if (from && a.startedAt < from) return false;
        if (to && a.startedAt > to) return false;
        return true;
      })
      .map(a => ({
        kind: 'agent_lifecycle' as const,
        agentId: a.id,
        agentType: a.type,
        model: a.model,
        status: a.status,
        startedAt: a.startedAt,
        completedAt: a.completedAt ?? null,
        durationMs: a.completedAt != null
          ? Date.parse(a.completedAt) - Date.parse(a.startedAt)
          : null,
        cardId: a.cardId ?? null,
      }));
  }

  // -------------------------------------------------------------------------
  // 3. Card transitions — look up card titles so the entry is self-contained
  // -------------------------------------------------------------------------
  let cardTransitionEntries: TimelineEntry[] = [];

  if (wantKind('card_transition') && rawStatusEvents.length > 0) {
    // Collect distinct cardIds so we can fetch titles in one query
    const cardIds = [...new Set(rawStatusEvents.map(e => e.cardId!))];
    const cardRows = db.select({ id: schema.cards.id, title: schema.cards.title })
      .from(schema.cards)
      .where(eq(schema.cards.projectId, projectId))
      .all();
    const cardTitleMap = new Map(cardRows.map(c => [c.id, c.title]));

    cardTransitionEntries = rawStatusEvents.map(e => {
      const { fromStatus, toStatus } = parseStatusChange(e.detail);
      return {
        kind: 'card_transition' as const,
        cardId: e.cardId!,
        cardTitle: cardTitleMap.get(e.cardId!) ?? null,
        fromStatus,
        toStatus,
        timestamp: e.timestamp,
      };
    });

    // Suppress unused-variable warning — cardIds used above in the Set construction
    void cardIds;
  }

  // -------------------------------------------------------------------------
  // 4. Quality scores — include all sub-dimension scores, not just the weighted
  //    composite, so callers can render breakdowns without a second request.
  // -------------------------------------------------------------------------
  let qualityEntries: TimelineEntry[] = [];

  if (wantKind('quality_score')) {
    const qualityConditions: SQL[] = [eq(schema.cards.projectId, projectId)];
    if (cardId) qualityConditions.push(eq(schema.cards.id, cardId));

    const qualityRows = db.select({
      id: schema.qualityScores.id,
      cardId: schema.qualityScores.cardId,
      weightedScore: schema.qualityScores.weightedScore,
      completeness: schema.qualityScores.completeness,
      codeQuality: schema.qualityScores.codeQuality,
      formatCompliance: schema.qualityScores.formatCompliance,
      independence: schema.qualityScores.independence,
      implementationType: schema.qualityScores.implementationType,
      createdAt: schema.qualityScores.createdAt,
    })
      .from(schema.qualityScores)
      .innerJoin(schema.cards, eq(schema.qualityScores.cardId, schema.cards.id))
      .where(and(...qualityConditions))
      .all();

    qualityEntries = qualityRows
      .filter(qs => {
        if (from && qs.createdAt < from) return false;
        if (to && qs.createdAt > to) return false;
        return true;
      })
      .map(qs => ({
        kind: 'quality_score' as const,
        cardId: qs.cardId,
        weightedScore: qs.weightedScore ?? 0,
        completeness: qs.completeness ?? null,
        codeQuality: qs.codeQuality ?? null,
        formatCompliance: qs.formatCompliance ?? null,
        independence: qs.independence ?? null,
        implementationType: qs.implementationType ?? null,
        timestamp: qs.createdAt,
      }));
  }

  // -------------------------------------------------------------------------
  // 5. Merge, sort DESC by effective timestamp, then paginate
  // -------------------------------------------------------------------------
  const merged: TimelineEntry[] = [
    ...eventEntries,
    ...agentEntries,
    ...cardTransitionEntries,
    ...qualityEntries,
  ].sort((a, b) => entryTimestamp(b).localeCompare(entryTimestamp(a)));

  res.json(merged.slice(offset, offset + limit));
});

export default router;
