import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { estimateCost } from '@vldr/shared';
import type { Agent } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

// GET /projects/:projectId/agents — list agents (filter by status, type, cardId)
router.get('/projects/:projectId/agents', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.agents).where(eq(schema.agents.projectId, req.params.projectId)).all();

  const { status, type, cardId } = req.query as {
    status?: string;
    type?: string;
    cardId?: string;
  };

  let filtered = rows;
  if (status) filtered = filtered.filter(a => a.status === status);
  if (type) filtered = filtered.filter(a => a.type === type);
  if (cardId) filtered = filtered.filter(a => a.cardId === cardId);

  res.json(filtered);
});

// GET /projects/:projectId/agents/tree — agent hierarchy as nested tree
router.get('/projects/:projectId/agents/tree', (req, res) => {
  const db = getDb();
  const agents = db.select().from(schema.agents)
    .where(eq(schema.agents.projectId, req.params.projectId))
    .all();

  const childrenMap = new Map<string | null, typeof agents>();
  for (const agent of agents) {
    const key = agent.parentAgentId;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(agent);
  }

  const epics = db.select().from(schema.epics)
    .where(eq(schema.epics.projectId, req.params.projectId))
    .all();
  const cards = db.select().from(schema.cards)
    .where(eq(schema.cards.projectId, req.params.projectId))
    .all();

  const cardEpicMap = new Map(cards.map(c => [c.id, epics.find(e => e.id === c.epicId)]));

  type TreeNode = {
    agent: typeof agents[number];
    children: TreeNode[];
    domainColor?: string;
    domainName?: string;
    subtreeCost: number;
    subtreeTokens: { prompt: number; completion: number; cacheCreation: number; cacheRead: number };
    subtreeAgentCount: number;
  };

  function buildNode(agent: typeof agents[number]): TreeNode {
    const children = (childrenMap.get(agent.id) ?? []).map(buildNode);
    const epic = agent.cardId ? cardEpicMap.get(agent.cardId) : undefined;

    const subtreeCost = agent.estimatedCost + children.reduce((s, c) => s + c.subtreeCost, 0);
    const subtreePrompt = agent.promptTokens + children.reduce((s, c) => s + c.subtreeTokens.prompt, 0);
    const subtreeCompletion = agent.completionTokens + children.reduce((s, c) => s + c.subtreeTokens.completion, 0);
    const subtreeCacheCreation = agent.cacheCreationTokens + children.reduce((s, c) => s + c.subtreeTokens.cacheCreation, 0);
    const subtreeCacheRead = agent.cacheReadTokens + children.reduce((s, c) => s + c.subtreeTokens.cacheRead, 0);
    const subtreeAgentCount = 1 + children.reduce((s, c) => s + c.subtreeAgentCount, 0);

    return {
      agent,
      children,
      domainColor: epic?.color,
      domainName: epic?.domain,
      subtreeCost,
      subtreeTokens: { prompt: subtreePrompt, completion: subtreeCompletion, cacheCreation: subtreeCacheCreation, cacheRead: subtreeCacheRead },
      subtreeAgentCount,
    };
  }

  const roots = agents.filter(a => !a.parentAgentId || !agents.find(p => p.id === a.parentAgentId));
  const tree = roots.map(buildNode);

  res.json(tree);
});

// GET /agents/:id — single agent by ID
router.get('/agents/:id', (req, res) => {
  const db = getDb();
  const [agent] = db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id)).all();
  if (!agent) return res.status(404).json({ error: `Agent ${req.params.id} not found` });
  res.json(agent);
});

// POST /agents — register agent spawn
router.post('/agents', (req, res) => {
  try {
    const { projectId, type, model, cardId, parentAgentId, personaId, detail } = req.body as {
      projectId?: string;
      type?: string;
      model?: string;
      cardId?: string;
      parentAgentId?: string;
      personaId?: string;
      detail?: string;
    };
    if (!projectId || !type || !model) throw new ApiError(400, 'projectId, type, and model are required');

    const db = getDb();
    const id = uuid();

    db.insert(schema.agents).values({
      id,
      projectId,
      type,
      model,
      status: 'running',
      ...(cardId != null ? { cardId } : {}),
      ...(parentAgentId != null ? { parentAgentId } : {}),
      ...(personaId != null ? { personaId } : {}),
      ...(detail != null ? { detail } : {}),
    }).run();

    const [agent] = db.select().from(schema.agents).where(eq(schema.agents.id, id)).all();
    broadcastToAll({ type: 'agent:started', data: agent as Agent });
    res.status(201).json(agent);
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.statusCode).json({ error: err.message });
    console.error('POST /agents error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /agents/:id — update agent
router.patch('/agents/:id', (req, res) => {
  try {
    const db = getDb();
    const [existing] = db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id)).all();
    if (!existing) throw new ApiError(404, `Agent ${req.params.id} not found`);

    const { status, promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens, model, detail, completedAt } = req.body as {
      status?: string;
      promptTokens?: number;
      completionTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      model?: string;
      detail?: string;
      completedAt?: string;
    };

    const updates: Record<string, unknown> = {};
    if (status != null) {
      updates.status = status;
      // Reset startedAt when reactivating a completed agent
      if (status === 'running' && existing.status !== 'running') {
        updates.startedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        updates.completedAt = null;
      }
    }
    if ((status === 'completed' || status === 'failed' || status === 'timeout') && !completedAt) {
      updates.completedAt = new Date().toISOString();
    }
    if (detail != null) updates.detail = detail;
    if (completedAt != null) updates.completedAt = completedAt;
    if (model != null) updates.model = model;

    // Recompute tokens and cost
    const newPromptTokens = promptTokens ?? existing.promptTokens;
    const newCompletionTokens = completionTokens ?? existing.completionTokens;
    const newCacheCreation = cacheCreationTokens ?? existing.cacheCreationTokens;
    const newCacheRead = cacheReadTokens ?? existing.cacheReadTokens;
    if (promptTokens != null) updates.promptTokens = newPromptTokens;
    if (completionTokens != null) updates.completionTokens = newCompletionTokens;
    if (cacheCreationTokens != null) updates.cacheCreationTokens = newCacheCreation;
    if (cacheReadTokens != null) updates.cacheReadTokens = newCacheRead;

    const effectiveModel = model ?? existing.model;
    if (promptTokens != null || completionTokens != null || cacheCreationTokens != null || cacheReadTokens != null || model != null) {
      updates.estimatedCost = estimateCost(effectiveModel, newPromptTokens, newCompletionTokens, newCacheCreation, newCacheRead);
    }

    db.update(schema.agents).set(updates).where(eq(schema.agents.id, req.params.id)).run();

    const [updated] = db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id)).all();
    broadcastToAll({ type: 'agent:updated', data: updated as Agent });
    res.json(updated);
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.statusCode).json({ error: err.message });
    console.error('PATCH /agents/:id error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
