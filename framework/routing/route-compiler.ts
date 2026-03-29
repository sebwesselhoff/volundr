/**
 * route-compiler.ts — route compilation and matching for Volundr work-type routing
 *
 * Compiles routing rules into an optimised, sorted structure and provides
 * conjunctive / disjunctive matching with priority-weighted scoring.
 *
 * Definitions:
 *  - Conjunctive match  — ALL conditions in a rule must match (AND semantics)
 *  - Disjunctive match  — ANY condition matching counts (OR semantics)
 *  - Priority score     — numeric priority from the rule table, tie-broken by
 *                         confidence weight and match count
 */

// --- Types ---

export type RuleConfidence = 'low' | 'medium' | 'high';

export interface RoutingRuleInput {
  id: number;
  workType: string;
  personaId: string;
  examples: string[] | null;
  confidence: RuleConfidence;
  modulePattern: string | null;
  priority: number;
  isActive: boolean;
}

export interface CompiledRule {
  id: number;
  workType: string;
  personaId: string;
  examples: string[];
  confidence: RuleConfidence;
  modulePattern: string | null;
  /** Parsed glob-to-regex for modulePattern, or null if no pattern. */
  moduleRegex: RegExp | null;
  priority: number;
  /** Confidence numeric weight: high=3, medium=2, low=1 */
  confidenceWeight: number;
}

export interface CompiledRouteTable {
  rules: CompiledRule[];
  /** Lookup index: workType (lower-cased) → rules */
  byWorkType: Map<string, CompiledRule[]>;
}

export interface MatchQuery {
  /** Free-text description of the work item. */
  description: string;
  /** Optional file path to match against modulePattern. */
  modulePath?: string;
  /** If true, all keyword conditions must match (AND). Default: false (OR). */
  conjunctive?: boolean;
}

export interface RouteMatch {
  rule: CompiledRule;
  score: number;
  matchedOn: string[];
}

export interface RouteMatchResult {
  description: string;
  matched: RouteMatch[];
  /** Best match (first in matched array), or null if none. */
  best: RouteMatch | null;
}

// --- Constants ---

const CONFIDENCE_WEIGHT: Record<RuleConfidence, number> = { high: 3, medium: 2, low: 1 };

// --- Compiler ---

/**
 * Compile raw routing rules into a sorted, indexed table.
 * Inactive rules are excluded. Rules are sorted by priority descending,
 * then by confidence weight descending.
 */
export function compileRoutes(rules: RoutingRuleInput[]): CompiledRouteTable {
  const compiled: CompiledRule[] = rules
    .filter((r) => r.isActive)
    .map((r) => {
      const confidenceWeight = CONFIDENCE_WEIGHT[r.confidence] ?? 2;
      return {
        id: r.id,
        workType: r.workType,
        personaId: r.personaId,
        examples: r.examples ?? [],
        confidence: r.confidence,
        modulePattern: r.modulePattern,
        moduleRegex: r.modulePattern ? globToRegex(r.modulePattern) : null,
        priority: r.priority,
        confidenceWeight,
      };
    })
    .sort((a, b) =>
      b.priority - a.priority || b.confidenceWeight - a.confidenceWeight || a.id - b.id,
    );

  const byWorkType = new Map<string, CompiledRule[]>();
  for (const rule of compiled) {
    const key = rule.workType.toLowerCase();
    const bucket = byWorkType.get(key) ?? [];
    bucket.push(rule);
    byWorkType.set(key, bucket);
  }

  return { rules: compiled, byWorkType };
}

// --- Matching ---

/**
 * Score a single rule against a query.
 *
 * Scoring components (all additive):
 *  - workType exact match (case-insensitive):   +10 × confidence weight
 *  - Each example phrase that matches:          +5  × confidence weight
 *  - modulePattern match (when modulePath given): +3 × confidence weight
 *
 * Returns null if no components matched.
 */
export function scoreRule(rule: CompiledRule, query: MatchQuery): RouteMatch | null {
  const descLower = query.description.toLowerCase();
  const matchedOn: string[] = [];
  let rawScore = 0;

  // workType match
  if (descLower.includes(rule.workType.toLowerCase())) {
    rawScore += 10;
    matchedOn.push(`workType:${rule.workType}`);
  }

  // Example phrase matches
  for (const ex of rule.examples) {
    if (descLower.includes(ex.toLowerCase())) {
      rawScore += 5;
      matchedOn.push(`example:${ex}`);
    }
  }

  // Module path match
  if (query.modulePath && rule.moduleRegex) {
    if (rule.moduleRegex.test(query.modulePath)) {
      rawScore += 3;
      matchedOn.push(`modulePattern:${rule.modulePattern}`);
    }
  }

  if (rawScore === 0) return null;

  const score = rawScore * rule.confidenceWeight + rule.priority;
  return { rule, score, matchedOn };
}

/**
 * Match a query against a compiled route table.
 *
 * Conjunctive mode: a rule only qualifies if ALL its defined conditions are
 * satisfied (workType in description, all examples present, module path matches).
 *
 * Disjunctive mode (default): any matching condition qualifies the rule.
 *
 * Returns results sorted by score descending.
 */
export function matchRoutes(table: CompiledRouteTable, query: MatchQuery): RouteMatchResult {
  const conjunctive = query.conjunctive ?? false;
  const results: RouteMatch[] = [];

  for (const rule of table.rules) {
    if (conjunctive) {
      const match = scoreRuleConjunctive(rule, query);
      if (match) results.push(match);
    } else {
      const match = scoreRule(rule, query);
      if (match) results.push(match);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return {
    description: query.description,
    matched: results,
    best: results[0] ?? null,
  };
}

/**
 * Conjunctive scoring: all defined conditions must match.
 * A rule with no examples / no modulePattern only requires the workType to match.
 */
function scoreRuleConjunctive(rule: CompiledRule, query: MatchQuery): RouteMatch | null {
  const descLower = query.description.toLowerCase();
  const matchedOn: string[] = [];
  let rawScore = 0;

  // workType is always required
  if (!descLower.includes(rule.workType.toLowerCase())) return null;
  rawScore += 10;
  matchedOn.push(`workType:${rule.workType}`);

  // All examples must match
  for (const ex of rule.examples) {
    if (!descLower.includes(ex.toLowerCase())) return null;
    rawScore += 5;
    matchedOn.push(`example:${ex}`);
  }

  // Module path must match if pattern is defined and modulePath is provided
  if (rule.moduleRegex && query.modulePath) {
    if (!rule.moduleRegex.test(query.modulePath)) return null;
    rawScore += 3;
    matchedOn.push(`modulePattern:${rule.modulePattern}`);
  }

  const score = rawScore * rule.confidenceWeight + rule.priority;
  return { rule, score, matchedOn };
}

// --- Glob to regex ---

/**
 * Convert a simple glob pattern to a RegExp.
 * Supported wildcards:
 *   **  — match any path segment (including separators)
 *   *   — match any characters except path separator
 *   ?   — match single character except path separator
 */
export function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches anything including slashes
      regexStr += '.*';
      i += 2;
      // consume optional trailing separator
      if (pattern[i] === '/') i++;
    } else if (ch === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else {
      // Escape regex special chars
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`, 'i');
}
