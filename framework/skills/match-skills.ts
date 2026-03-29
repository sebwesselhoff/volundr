/**
 * match-skills.ts — pure function skill matching (no DB, no HTTP)
 *
 * Used by POST /api/skills/match and any framework consumer that needs
 * keyword-based scoring without touching the database directly.
 */

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  version: number;
  validatedAt: string;
  reviewByDate: string;
  triggers: string[];
  roles: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatchInput {
  query: string;
  domain?: string;
  roles?: string[];
  limit?: number;
}

export interface MatchResult {
  skill: SkillRecord;
  score: number;
  matchedTriggers: string[];
}

/** Confidence weight multiplier applied to the raw keyword score. */
const CONFIDENCE_WEIGHT: Record<string, number> = {
  high: 1.5,
  medium: 1.0,
  low: 0.6,
};

/**
 * Score a single skill against a set of query terms.
 *
 * Scoring rules:
 *  - Trigger match (bidirectional substring):  +2 per term (de-duped)
 *  - Name match:                                +1 per term
 *  - Description match:                         +1 per term
 * Final score is multiplied by the confidence weight.
 *
 * Returns null if the skill doesn't pass domain/role filters or scores 0.
 */
export function scoreSkill(
  skill: SkillRecord,
  queryTerms: string[],
  opts: { domain?: string; roles?: string[] } = {},
): MatchResult | null {
  // Domain filter
  if (opts.domain && skill.domain !== opts.domain) return null;

  // Role filter — empty skill.roles means available to all
  if (opts.roles && opts.roles.length > 0 && skill.roles.length > 0) {
    const hasRole = opts.roles.some((r) => skill.roles.includes(r));
    if (!hasRole) return null;
  }

  let rawScore = 0;
  const matchedSet = new Set<string>();

  // Precompute lowercase fields once per skill
  const triggersLower = skill.triggers.map(t => ({ original: t, lower: t.toLowerCase() }));
  const nameLower = skill.name.toLowerCase();
  const descLower = skill.description.toLowerCase();

  for (const term of queryTerms) {
    // Trigger matches weighted 2x
    for (const { original, lower } of triggersLower) {
      if (lower.includes(term) || term.includes(lower)) {
        rawScore += 2;
        matchedSet.add(original);
      }
    }
    // Name match 1x
    if (nameLower.includes(term)) rawScore += 1;
    // Description match 1x
    if (descLower.includes(term)) rawScore += 1;
  }

  if (rawScore === 0) return null;

  const weight = CONFIDENCE_WEIGHT[skill.confidence] ?? 1.0;
  const score = rawScore * weight;

  return { skill, score, matchedTriggers: [...matchedSet] };
}

/**
 * Match skills against a free-text query.
 *
 * @param skills  - full list of skill records (caller fetches from DB)
 * @param input   - query, optional domain/roles filter, optional limit (default 10)
 * @returns sorted array of MatchResult (highest score first), capped at limit
 */
export function matchSkills(skills: SkillRecord[], input: MatchInput): MatchResult[] {
  const queryTerms = input.query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (queryTerms.length === 0) return [];

  const results: MatchResult[] = [];

  for (const skill of skills) {
    const result = scoreSkill(skill, queryTerms, {
      domain: input.domain,
      roles: input.roles,
    });
    if (result) results.push(result);
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, input.limit ?? 10);
}
