/**
 * auto-routing.ts — Auto-routing integration for card assignment
 *
 * Provides a single function that the cards API calls on card creation
 * to automatically assign a persona based on active routing rules.
 *
 * This module is the integration layer between the DB (routing_rules table)
 * and the RoutingEngine (framework/routing/routing-engine.ts).
 *
 * Usage (in cards API):
 *   import { autoRouteCard } from '../../../framework/routing/auto-routing.js';
 *   const result = autoRouteCard(db, { title, description, size });
 *   // result.personaId, result.confidence, result.reason
 */

import { compileRoutes, matchRoutes } from './route-compiler.js';
import type { RoutingRuleInput, RouteMatchResult } from './route-compiler.js';

// --- Types ---

export interface AutoRouteInput {
  /** Card title + description concatenated (used as match description). */
  description: string;
  /** Optional file path to match against module patterns. */
  modulePath?: string;
}

export interface AutoRouteResult {
  /** Matched persona ID, or null if no rule matched. */
  personaId: string | null;
  /** Routing confidence: matches the winning rule's confidence, or null. */
  confidence: 'low' | 'medium' | 'high' | null;
  /** Human-readable reason string for audit trail. */
  reason: string | null;
  /** Full match details for debugging. */
  matchResult: RouteMatchResult;
}

// --- DB row shape (minimal, matches routing_rules table) ---

interface RoutingRuleRow {
  id: number;
  work_type: string;
  persona_id: string;
  examples: string | null;
  confidence: string;
  module_pattern: string | null;
  priority: number;
  is_active: number | boolean;
}

// --- Core function ---

/**
 * Auto-route a card against all active routing rules in the DB.
 *
 * Accepts a raw SQLite DB instance (better-sqlite3) to avoid coupling
 * to the drizzle ORM layer, which is not available in the framework package.
 *
 * @param rawSqlite  A better-sqlite3 Database instance (pass getRawSqlite() from @vldr/db)
 * @param input      Card routing input
 * @returns          AutoRouteResult with personaId, confidence, and reason
 */
export function autoRouteCard(
  rawSqlite: { prepare: (sql: string) => { all: () => RoutingRuleRow[] } },
  input: AutoRouteInput,
): AutoRouteResult {
  const rows = rawSqlite
    .prepare(
      `SELECT id, work_type, persona_id, examples, confidence, module_pattern, priority, is_active
       FROM routing_rules WHERE is_active = 1`,
    )
    .all();

  const rules: RoutingRuleInput[] = rows.map((row) => ({
    id: row.id,
    workType: row.work_type,
    personaId: row.persona_id,
    examples: row.examples
      ? (() => { try { return JSON.parse(row.examples!) as string[]; } catch { return null; } })()
      : null,
    confidence: (row.confidence as 'low' | 'medium' | 'high') ?? 'medium',
    modulePattern: row.module_pattern,
    priority: row.priority,
    isActive: true,
  }));

  if (rules.length === 0) {
    return { personaId: null, confidence: null, reason: 'No active routing rules', matchResult: { description: input.description, matched: [], best: null } };
  }

  const table = compileRoutes(rules);
  const matchResult = matchRoutes(table, {
    description: input.description,
    modulePath: input.modulePath,
    conjunctive: false,
  });

  if (!matchResult.best) {
    return { personaId: null, confidence: null, reason: 'No routing rule matched', matchResult };
  }

  const best = matchResult.best;
  const matchedOn = best.matchedOn.join(', ');
  const reason = `Matched rule #${best.rule.id} (${best.rule.workType}) via [${matchedOn}] — score ${best.score}`;

  return {
    personaId: best.rule.personaId,
    confidence: best.rule.confidence,
    reason,
    matchResult,
  };
}

/**
 * Build a combined description string from card title and description.
 * Used by the cards API when calling autoRouteCard.
 */
export function buildRoutingDescription(title: string, description: string): string {
  return description ? `${title} ${description}` : title;
}
