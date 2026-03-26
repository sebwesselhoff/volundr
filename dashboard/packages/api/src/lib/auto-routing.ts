/**
 * auto-routing.ts — Auto-routing integration for card assignment
 *
 * Provides a single function that the cards API calls on card creation
 * to automatically assign a persona based on active routing rules.
 *
 * Logic mirrors framework/routing/route-compiler.ts (kept in sync manually).
 * Kept in-package to stay within the API's TypeScript rootDir boundary.
 */

// --- Types ---

type RuleConfidence = 'low' | 'medium' | 'high';

const CONFIDENCE_WEIGHT: Record<RuleConfidence, number> = { high: 3, medium: 2, low: 1 };

interface CompiledRule {
  id: number;
  workType: string;
  personaId: string;
  examples: string[];
  confidence: RuleConfidence;
  modulePattern: string | null;
  moduleRegex: RegExp | null;
  priority: number;
  confidenceWeight: number;
}

interface RouteMatch {
  rule: CompiledRule;
  score: number;
  matchedOn: string[];
}

export interface AutoRouteInput {
  description: string;
  modulePath?: string;
}

export interface AutoRouteResult {
  personaId: string | null;
  confidence: RuleConfidence | null;
  reason: string | null;
}

// --- DB row shape (raw SQLite row from routing_rules) ---

interface RoutingRuleRow {
  id: number;
  work_type: string;
  persona_id: string;
  examples: string | null;
  confidence: string;
  module_pattern: string | null;
  priority: number;
}

// --- Helpers ---

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

function compileRule(row: RoutingRuleRow): CompiledRule {
  const confidence = (row.confidence as RuleConfidence) ?? 'medium';
  const confidenceWeight = CONFIDENCE_WEIGHT[confidence] ?? 2;
  let examples: string[] = [];
  if (row.examples) {
    try { examples = JSON.parse(row.examples) as string[]; } catch { /* ignore */ }
  }
  return {
    id: row.id,
    workType: row.work_type,
    personaId: row.persona_id,
    examples,
    confidence,
    modulePattern: row.module_pattern,
    moduleRegex: row.module_pattern ? globToRegex(row.module_pattern) : null,
    priority: row.priority,
    confidenceWeight,
  };
}

function scoreRule(rule: CompiledRule, descLower: string, modulePath?: string): RouteMatch | null {
  const matchedOn: string[] = [];
  let rawScore = 0;

  if (descLower.includes(rule.workType.toLowerCase())) {
    rawScore += 10;
    matchedOn.push(`workType:${rule.workType}`);
  }

  for (const ex of rule.examples) {
    if (descLower.includes(ex.toLowerCase())) {
      rawScore += 5;
      matchedOn.push(`example:${ex}`);
    }
  }

  if (modulePath && rule.moduleRegex && rule.moduleRegex.test(modulePath)) {
    rawScore += 3;
    matchedOn.push(`modulePattern:${rule.modulePattern}`);
  }

  if (rawScore === 0) return null;

  const score = rawScore * rule.confidenceWeight + rule.priority;
  return { rule, score, matchedOn };
}

// --- Public API ---

/**
 * Auto-route a card against all active routing rules from the DB.
 *
 * @param rawSqlite  A better-sqlite3 Database instance (getRawSqlite() from @vldr/db)
 * @param input      Description and optional module path
 */
export function autoRouteCard(
  rawSqlite: { prepare: (sql: string) => { all: () => RoutingRuleRow[] } },
  input: AutoRouteInput,
): AutoRouteResult {
  const rows = rawSqlite
    .prepare(
      `SELECT id, work_type, persona_id, examples, confidence, module_pattern, priority
       FROM routing_rules WHERE is_active = 1`,
    )
    .all();

  if (rows.length === 0) {
    return { personaId: null, confidence: null, reason: 'No active routing rules' };
  }

  const compiled = rows
    .map(compileRule)
    .sort((a, b) => b.priority - a.priority || b.confidenceWeight - a.confidenceWeight || a.id - b.id);

  const descLower = input.description.toLowerCase();
  const matches: RouteMatch[] = [];

  for (const rule of compiled) {
    const m = scoreRule(rule, descLower, input.modulePath);
    if (m) matches.push(m);
  }

  matches.sort((a, b) => b.score - a.score);
  const best = matches[0] ?? null;

  if (!best) {
    return { personaId: null, confidence: null, reason: 'No routing rule matched' };
  }

  const matchedOn = best.matchedOn.join(', ');
  const reason = `Matched rule #${best.rule.id} (${best.rule.workType}) via [${matchedOn}] — score ${best.score}`;

  return {
    personaId: best.rule.personaId,
    confidence: best.rule.confidence,
    reason,
  };
}

/**
 * Build a combined description string from card title and description.
 */
export function buildRoutingDescription(title: string, description: string): string {
  return description ? `${title} ${description}` : title;
}
