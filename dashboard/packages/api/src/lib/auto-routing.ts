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
  negativeKeywords: string[];
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
  negative_keywords: string | null;
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

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function compileRule(row: RoutingRuleRow): CompiledRule {
  const confidence = (row.confidence as RuleConfidence) ?? 'medium';
  const confidenceWeight = CONFIDENCE_WEIGHT[confidence] ?? 2;
  return {
    id: row.id,
    workType: row.work_type,
    personaId: row.persona_id,
    examples: parseJsonArray(row.examples),
    negativeKeywords: parseJsonArray(row.negative_keywords),
    confidence,
    modulePattern: row.module_pattern,
    moduleRegex: row.module_pattern ? globToRegex(row.module_pattern) : null,
    priority: row.priority,
    confidenceWeight,
  };
}

// Token cache: keep regex compilation off the hot path for repeated routings.
const tokenRegexCache = new Map<string, RegExp>();

/**
 * Whole-token containment test (FRW-BL-024).
 *
 * Replaces the old `haystack.includes(token)` substring match, which produced
 * false positives like "token" ⊂ "CancellationToken", "orm" ⊂ "normalize",
 * "auth" ⊂ "OAuth", "ui" ⊂ "build", "seo"/"sso" inside larger words. We require
 * the token to be flanked by non-alphanumeric boundaries (or string edges).
 * Alphanumerics ([a-z0-9]) define a "word"; punctuation in the token itself
 * (`.net`, `c#`, `sign-in`, `access control`) is matched literally, so multi-word
 * and symbol-bearing tokens still work.
 */
function containsToken(haystackLower: string, token: string): boolean {
  const t = token.toLowerCase().trim();
  if (!t) return false;
  let re = tokenRegexCache.get(t);
  if (!re) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Boundaries: not preceded/followed by an alphanumeric. Works for tokens that
    // start/end with punctuation (.net, c#) because the lookarounds only forbid
    // an adjacent [a-z0-9], not adjacent punctuation.
    re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i');
    tokenRegexCache.set(t, re);
  }
  return re.test(haystackLower);
}

function scoreRule(rule: CompiledRule, descLower: string, modulePath?: string): RouteMatch | null {
  // Negative-keyword suppression: if any negative keyword is present as a whole
  // token, this rule does not fire at all — no matter how strong the positives.
  for (const neg of rule.negativeKeywords) {
    if (containsToken(descLower, neg)) {
      return null;
    }
  }

  const matchedOn: string[] = [];
  let rawScore = 0;

  if (containsToken(descLower, rule.workType)) {
    rawScore += 10;
    matchedOn.push(`workType:${rule.workType}`);
  }

  for (const ex of rule.examples) {
    if (containsToken(descLower, ex)) {
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
/**
 * Pure routing core: score raw routing-rule rows against an input and return the
 * best match. Shared by the production DB path (`autoRouteCard`), the replay
 * harness (`scripts/route-replay.mjs`), and the regression tests so all three
 * exercise IDENTICAL scoring — no drift between what we test and what ships.
 */
export function autoRouteFromRows(
  rows: RoutingRuleRow[],
  input: AutoRouteInput,
): AutoRouteResult {
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
      `SELECT id, work_type, persona_id, examples, negative_keywords, confidence, module_pattern, priority
       FROM routing_rules WHERE is_active = 1`,
    )
    .all();

  return autoRouteFromRows(rows, input);
}

/**
 * Build a combined description string from card title and description.
 */
export function buildRoutingDescription(title: string, description: string): string {
  return description ? `${title} ${description}` : title;
}
