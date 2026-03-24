import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';

export function validateDeps(projectId: string, cardId: string, deps: string[]) {
  if (deps.length === 0) return;
  const db = getDb();
  const projectCards = db.select({ id: schema.cards.id, deps: schema.cards.deps })
    .from(schema.cards).where(eq(schema.cards.projectId, projectId)).all();
  const cardIds = new Set(projectCards.map(c => c.id));
  cardIds.add(cardId);

  for (const dep of deps) {
    if (!cardIds.has(dep)) throw new ApiError(400, `Dependency ${dep} does not exist in project ${projectId}`);
    if (dep === cardId) throw new ApiError(400, 'Card cannot depend on itself');
  }

  // Cycle detection via DFS
  const graph = new Map<string, string[]>();
  for (const card of projectCards) {
    if (card.id === cardId) continue;
    graph.set(card.id, card.deps ? JSON.parse(card.deps) : []);
  }
  graph.set(cardId, deps);

  const visited = new Set<string>();
  const inStack = new Set<string>();
  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  }
  if (dfs(cardId)) throw new ApiError(400, 'Circular dependency detected');
}
