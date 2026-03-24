import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq, and, gte, lte, SQL } from 'drizzle-orm';

const router = Router();

// GET /projects/:projectId/metrics — aggregated metrics
router.get('/projects/:projectId/metrics', (req, res) => {
  const db = getDb();
  const { projectId } = req.params;
  const { from: fromStr, to: toStr } = req.query as { from?: string; to?: string };

  const fromTime = fromStr ?? '1970-01-01T00:00:00.000Z';
  const toTime = toStr ?? new Date().toISOString();

  // Fetch agents within time range
  const agentConditions: SQL[] = [
    eq(schema.agents.projectId, projectId),
    gte(schema.agents.startedAt, fromTime),
    lte(schema.agents.startedAt, toTime),
  ];
  const agents = db.select().from(schema.agents).where(and(...agentConditions)).all();

  // Fetch all cards and epics for this project
  const cards = db.select().from(schema.cards).where(eq(schema.cards.projectId, projectId)).all();
  const epics = db.select().from(schema.epics).where(eq(schema.epics.projectId, projectId)).all();
  const epicNameMap = new Map(epics.map(e => [e.id, e.name]));

  // Fetch quality scores via inner join
  const qualityRows = db.select({
    cardId: schema.qualityScores.cardId,
    weightedScore: schema.qualityScores.weightedScore,
    createdAt: schema.qualityScores.createdAt,
  })
    .from(schema.qualityScores)
    .innerJoin(schema.cards, eq(schema.qualityScores.cardId, schema.cards.id))
    .where(eq(schema.cards.projectId, projectId))
    .all();

  // Token aggregations
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  const tokensByModel: Record<string, { prompt: number; completion: number; cacheCreation: number; cacheRead: number }> = {};
  const tokensOverTimeMap: Record<string, { prompt: number; completion: number; cacheCreation: number; cacheRead: number }> = {};
  let totalEstimatedCost = 0;
  const costByModel: Record<string, number> = {};
  const agentsByType: Record<string, number> = {};
  const agentsByModel: Record<string, number> = {};

  for (const agent of agents) {
    totalPromptTokens += agent.promptTokens;
    totalCompletionTokens += agent.completionTokens;
    totalCacheCreationTokens += agent.cacheCreationTokens;
    totalCacheReadTokens += agent.cacheReadTokens;
    totalEstimatedCost += agent.estimatedCost;

    if (!tokensByModel[agent.model]) tokensByModel[agent.model] = { prompt: 0, completion: 0, cacheCreation: 0, cacheRead: 0 };
    tokensByModel[agent.model].prompt += agent.promptTokens;
    tokensByModel[agent.model].completion += agent.completionTokens;
    tokensByModel[agent.model].cacheCreation += agent.cacheCreationTokens;
    tokensByModel[agent.model].cacheRead += agent.cacheReadTokens;

    if (!costByModel[agent.model]) costByModel[agent.model] = 0;
    costByModel[agent.model] += agent.estimatedCost;

    agentsByType[agent.type] = (agentsByType[agent.type] ?? 0) + 1;
    agentsByModel[agent.model] = (agentsByModel[agent.model] ?? 0) + 1;

    // SQLite datetime('now') stores as "YYYY-MM-DD HH:MM:SS" — normalize to ISO hour bucket
    const raw = (agent.startedAt ?? '').replace(' ', 'T');
    const hourBucket = raw.slice(0, 13) + ':00'; // YYYY-MM-DDTHH:00
    if (!tokensOverTimeMap[hourBucket]) tokensOverTimeMap[hourBucket] = { prompt: 0, completion: 0, cacheCreation: 0, cacheRead: 0 };
    tokensOverTimeMap[hourBucket].prompt += agent.promptTokens;
    tokensOverTimeMap[hourBucket].completion += agent.completionTokens;
    tokensOverTimeMap[hourBucket].cacheCreation += agent.cacheCreationTokens;
    tokensOverTimeMap[hourBucket].cacheRead += agent.cacheReadTokens;
  }

  const tokensOverTime = Object.entries(tokensOverTimeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, tokens]) => ({ timestamp, ...tokens }));

  // Cost by epic
  const costByEpic: Record<string, number> = {};
  for (const agent of agents) {
    if (agent.cardId) {
      const card = cards.find(c => c.id === agent.cardId);
      if (card) {
        const epicName = epicNameMap.get(card.epicId) ?? card.epicId;
        costByEpic[epicName] = (costByEpic[epicName] ?? 0) + agent.estimatedCost;
      }
    }
  }

  // Cards by status
  const cardsByStatus: Record<string, number> = {};
  for (const card of cards) {
    cardsByStatus[card.status] = (cardsByStatus[card.status] ?? 0) + 1;
  }

  // Quality stats
  const scores = qualityRows.map(r => r.weightedScore ?? 0);
  const averageQualityScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const qualityTrend = qualityRows
    .filter(r => r.weightedScore != null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(r => ({ cardId: r.cardId, timestamp: r.createdAt, score: r.weightedScore! }));

  // Cards completed per hour (rolling average)
  const completedCards = cards.filter(c => c.completedAt != null);
  let cardsCompletedPerHour = 0;
  if (completedCards.length >= 2) {
    const sorted = completedCards
      .map(c => new Date(c.completedAt!).getTime())
      .sort((a, b) => a - b);
    const spanMs = sorted[sorted.length - 1] - sorted[0];
    const spanHours = spanMs / (1000 * 60 * 60);
    if (spanHours > 0) cardsCompletedPerHour = completedCards.length / spanHours;
  }

  // Retry metrics: cards with more than 1 agent
  const agentCountByCard: Record<string, number> = {};
  for (const agent of agents) {
    if (agent.cardId) agentCountByCard[agent.cardId] = (agentCountByCard[agent.cardId] ?? 0) + 1;
  }
  const retryCount = Object.values(agentCountByCard).filter(n => n > 1).length;
  const totalCardsWithAgents = Object.keys(agentCountByCard).length;
  const retryRate = totalCardsWithAgents > 0 ? retryCount / totalCardsWithAgents : 0;

  // Active agents: only those currently running
  const activeAgents = agents.filter(a => a.status === 'running').length;

  res.json({
    totalPromptTokens,
    totalCompletionTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    tokensByModel,
    tokensOverTime,
    totalEstimatedCost,
    costByEpic,
    costByModel,
    averageQualityScore,
    qualityTrend,
    cardsCompletedPerHour,
    cardsByStatus,
    activeAgents,
    totalAgentsSpawned: agents.length,
    agentsByType,
    agentsByModel,
    retryCount,
    retryRate,
    timeRange: { from: fromTime, to: toTime },
  });
});

export default router;
