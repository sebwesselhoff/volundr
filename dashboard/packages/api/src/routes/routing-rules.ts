import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import type { RoutingRule } from '@vldr/shared';
import { ApiError } from '../middleware/error-handler.js';

const router = Router();

// GET /routing-rules — list all active rules (sorted by priority desc)
router.get('/routing-rules', (req, res) => {
  const db = getDb();
  const rows = db.select().from(schema.routingRules).all();
  const sorted = rows
    .filter(r => r.isActive)
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
  res.json(sorted.map(parseExamples) as RoutingRule[]);
});

// GET /routing-rules/:id — get single rule
router.get('/routing-rules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');
  const db = getDb();
  const [rule] = db.select().from(schema.routingRules)
    .where(eq(schema.routingRules.id, id))
    .all();
  if (!rule) throw new ApiError(404, `Routing rule ${id} not found`);
  res.json(parseExamples(rule) as RoutingRule);
});

// Route compiler helpers (mirrors framework/routing/route-compiler.ts — inline to avoid cross-package import)

type RuleConfidence = 'low' | 'medium' | 'high';
const ROUTE_CONFIDENCE_WEIGHT: Record<RuleConfidence, number> = { high: 3, medium: 2, low: 1 };

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      regexStr += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (ch === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else {
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`, 'i');
}

interface ScoredRule {
  rule: ReturnType<typeof parseExamples>;
  score: number;
  matchedOn: string[];
}

function scoreRoutingRule(
  rule: typeof schema.routingRules.$inferSelect,
  descLower: string,
  modulePath: string | undefined,
  conjunctive: boolean,
): ScoredRule | null {
  const examples = rule.examples
    ? (() => { try { return JSON.parse(rule.examples) as string[]; } catch { return [] as string[]; } })()
    : [] as string[];

  const confidenceWeight = ROUTE_CONFIDENCE_WEIGHT[(rule.confidence as RuleConfidence)] ?? 2;
  const matchedOn: string[] = [];
  let rawScore = 0;

  const workTypeMatch = descLower.includes(rule.workType.toLowerCase());
  if (conjunctive && !workTypeMatch) return null;
  if (workTypeMatch) { rawScore += 10; matchedOn.push(`workType:${rule.workType}`); }

  for (const ex of examples) {
    const exMatch = descLower.includes(ex.toLowerCase());
    if (conjunctive && !exMatch) return null;
    if (exMatch) { rawScore += 5; matchedOn.push(`example:${ex}`); }
  }

  const moduleRegex = rule.modulePattern ? globToRegex(rule.modulePattern) : null;
  if (moduleRegex && modulePath) {
    const modMatch = moduleRegex.test(modulePath);
    if (conjunctive && !modMatch) return null;
    if (modMatch) { rawScore += 3; matchedOn.push(`modulePattern:${rule.modulePattern}`); }
  }

  if (rawScore === 0) return null;

  const score = rawScore * confidenceWeight + rule.priority;
  return { rule: parseExamples(rule), score, matchedOn };
}

// POST /routing-rules/test — conjunctive/disjunctive matching with priority scoring
router.post('/routing-rules/test', (req, res) => {
  const { description, modulePath, conjunctive } = req.body as {
    description?: string;
    modulePath?: string;
    conjunctive?: boolean;
  };
  if (!description) throw new ApiError(400, 'description is required');

  const db = getDb();
  const allRules = db.select().from(schema.routingRules).all().filter(r => r.isActive);
  const descLower = description.toLowerCase();

  const scored: ScoredRule[] = [];
  for (const rule of allRules) {
    const result = scoreRoutingRule(rule, descLower, modulePath, conjunctive ?? false);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score);
  res.json({ description, modulePath: modulePath ?? null, conjunctive: conjunctive ?? false, matched: scored });
});

// POST /routing-rules — create rule
router.post('/routing-rules', (req, res) => {
  const { workType, personaId, examples, confidence, modulePattern, priority, isActive } = req.body as {
    workType?: string;
    personaId?: string;
    examples?: string[];
    confidence?: string;
    modulePattern?: string;
    priority?: number;
    isActive?: boolean;
  };

  if (!workType) throw new ApiError(400, 'workType is required');
  if (!personaId) throw new ApiError(400, 'personaId is required');

  const db = getDb();
  const result = db.insert(schema.routingRules).values({
    workType,
    personaId,
    examples: examples ? JSON.stringify(examples) : null,
    confidence: (confidence as any) ?? 'medium',
    modulePattern: modulePattern ?? null,
    priority: priority ?? 0,
    isActive: isActive !== false,
  }).run();

  const [created] = db.select().from(schema.routingRules)
    .where(eq(schema.routingRules.id, Number(result.lastInsertRowid)))
    .all();
  res.status(201).json(parseExamples(created) as RoutingRule);
});

// PATCH /routing-rules/:id — update rule
router.patch('/routing-rules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');

  const db = getDb();
  const [existing] = db.select().from(schema.routingRules)
    .where(eq(schema.routingRules.id, id))
    .all();
  if (!existing) throw new ApiError(404, `Routing rule ${id} not found`);

  const { workType, personaId, examples, confidence, modulePattern, priority, isActive } = req.body as {
    workType?: string;
    personaId?: string;
    examples?: string[];
    confidence?: string;
    modulePattern?: string;
    priority?: number;
    isActive?: boolean;
  };

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const updates: Record<string, unknown> = { updatedAt: now };
  if (workType != null) updates.workType = workType;
  if (personaId != null) updates.personaId = personaId;
  if (examples !== undefined) updates.examples = examples ? JSON.stringify(examples) : null;
  if (confidence != null) updates.confidence = confidence;
  if (modulePattern !== undefined) updates.modulePattern = modulePattern ?? null;
  if (priority != null) updates.priority = priority;
  if (isActive != null) updates.isActive = isActive;

  db.update(schema.routingRules).set(updates)
    .where(eq(schema.routingRules.id, id))
    .run();

  const [updated] = db.select().from(schema.routingRules)
    .where(eq(schema.routingRules.id, id))
    .all();
  res.json(parseExamples(updated) as RoutingRule);
});

// DELETE /routing-rules/:id — soft delete (set is_active = false), ?hard=true for hard delete
router.delete('/routing-rules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, 'id must be a number');

  const db = getDb();
  const [existing] = db.select().from(schema.routingRules)
    .where(eq(schema.routingRules.id, id))
    .all();
  if (!existing) throw new ApiError(404, `Routing rule ${id} not found`);

  if (req.query.hard === 'true') {
    db.delete(schema.routingRules).where(eq(schema.routingRules.id, id)).run();
  } else {
    db.update(schema.routingRules)
      .set({ isActive: false, updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') })
      .where(eq(schema.routingRules.id, id))
      .run();
  }
  res.status(204).send();
});

function parseExamples(rule: typeof schema.routingRules.$inferSelect) {
  return {
    ...rule,
    examples: rule.examples
      ? (() => { try { return JSON.parse(rule.examples!); } catch { return null; } })()
      : null,
  };
}

export default router;
