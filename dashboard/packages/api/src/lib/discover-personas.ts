/**
 * discover-personas.ts — persona auto-discovery from tech stack signals
 *
 * Scores persona seeds against a list of tech stack keywords and returns
 * ranked recommendations.  Pure function — no DB access, no HTTP.
 *
 * Algorithm:
 *   For each persona definition, score against each stack signal:
 *     - expertise match (bidirectional substring):  +3 per signal
 *     - role match (exact):                         +2 (once, if role matches any signal)
 *     - identity keyword match in name:             +1 per signal
 *   Final score is the sum; personas with score = 0 are excluded.
 *
 * Recommendations are capped at `limit` (default 5).
 */

export interface PersonaSeedDefinition {
  id: string;
  name: string;
  role: string;
  expertiseKeywords: string[];  // pre-split expertise string
}

export interface DiscoveryResult {
  personaId: string;
  name: string;
  role: string;
  score: number;
  matchedSignals: string[];
  reason: string;
}

export interface DiscoverPersonasInput {
  /** Raw tech stack signals — e.g. ["typescript", "react", "postgresql", "docker"] */
  stackSignals: string[];
  /** Max personas to return (default 5) */
  limit?: number;
  /** If set, only return personas with this role */
  roleFilter?: string;
}

// ---- Seed definitions -------------------------------------------------------

/**
 * Canonical persona seed definitions extracted from framework/personas/seeds/.
 * Kept inline so the API package stays self-contained.
 * Update this list when adding new seeds to the framework.
 */
export const PERSONA_SEEDS: PersonaSeedDefinition[] = [
  {
    id: 'architect',
    name: 'Riley Okonkwo',
    role: 'architect',
    expertiseKeywords: [
      'system design', 'api contract', 'service boundaries', 'dependency analysis',
      'data flow', 'scalability', 'event-driven', 'monolith', 'modular', 'architecture',
    ],
  },
  {
    id: 'auth-specialist',
    name: 'Priya Mehta',
    role: 'developer',
    expertiseKeywords: [
      'oauth2', 'oidc', 'jwt', 'rbac', 'msal', 'session', 'pkce', 'token', 'mfa',
      'saml', 'auth', 'authentication', 'authorisation', 'authorization',
    ],
  },
  {
    id: 'database-engineer',
    name: 'Morgan Lee',
    role: 'developer',
    expertiseKeywords: [
      'sql', 'sqlite', 'postgresql', 'postgres', 'mysql', 'drizzle', 'prisma',
      'query', 'schema', 'migration', 'index', 'normalization', 'orm', 'database', 'db',
    ],
  },
  {
    id: 'data-engineer',
    name: 'Lin Zhao',
    role: 'developer',
    expertiseKeywords: [
      'etl', 'pipeline', 'csv', 'xml', 'json', 'mapping', 'validation',
      'transformation', 'cosi', 'infor', 'sap', 'data', 'integration flow',
    ],
  },
  {
    id: 'devops-infra',
    name: 'Sam Rivera',
    role: 'devops-engineer',
    expertiseKeywords: [
      'docker', 'docker compose', 'ci', 'cd', 'github actions', 'shell', 'azure',
      'gcp', 'aws', 'iac', 'nginx', 'deployment', 'infrastructure', 'devops', 'kubernetes', 'k8s',
    ],
  },
  {
    id: 'documentation-engineer',
    name: 'Dana Kowalski',
    role: 'content',
    expertiseKeywords: [
      'openapi', 'swagger', 'adr', 'runbook', 'readme', 'docs', 'documentation',
      'changelog', 'api reference', 'technical writing', 'onboarding',
    ],
  },
  {
    id: 'fullstack-web',
    name: 'Alex Chen',
    role: 'developer',
    expertiseKeywords: [
      'typescript', 'react', 'nextjs', 'next.js', 'node', 'nodejs', 'express',
      'tailwind', 'rest', 'trpc', 'tRPC', 'frontend', 'backend', 'fullstack', 'web',
    ],
  },
  {
    id: 'migration-engineer',
    name: 'Tobias Holt',
    role: 'developer',
    expertiseKeywords: [
      'schema evolution', 'backfill', 'zero-downtime', 'rollback', 'expand-contract',
      'flyway', 'liquibase', 'migration', 'drizzle', 'data migration',
    ],
  },
  {
    id: 'security-reviewer',
    name: 'Casey Voss',
    role: 'reviewer',
    expertiseKeywords: [
      'owasp', 'auth audit', 'jwt security', 'secret', 'pii', 'vulnerability',
      'injection', 'cors', 'csp', 'security', 'pentest', 'xss', 'csrf',
    ],
  },
  {
    id: 'test-engineer',
    name: 'Jordan Park',
    role: 'qa-engineer',
    expertiseKeywords: [
      'test', 'unit test', 'integration test', 'e2e', 'playwright', 'cypress',
      'vitest', 'jest', 'coverage', 'mock', 'stub', 'xunit', 'qa', 'quality',
    ],
  },
];

// ---- Scoring ----------------------------------------------------------------

function scorePersona(
  persona: PersonaSeedDefinition,
  signals: string[],
): { score: number; matchedSignals: string[] } {
  let score = 0;
  const matchedSignals: string[] = [];

  for (const signal of signals) {
    const sigLower = signal.toLowerCase();
    let hitThisSignal = false;

    // Role match
    if (persona.role.toLowerCase() === sigLower) {
      score += 2;
      hitThisSignal = true;
    }

    // Expertise keyword match (bidirectional substring)
    for (const kw of persona.expertiseKeywords) {
      const kwLower = kw.toLowerCase();
      if (kwLower.includes(sigLower) || sigLower.includes(kwLower)) {
        score += 3;
        hitThisSignal = true;
        break; // one match per signal per expertise list
      }
    }

    // Name match
    if (persona.name.toLowerCase().includes(sigLower)) {
      score += 1;
      hitThisSignal = true;
    }

    if (hitThisSignal && !matchedSignals.includes(signal)) {
      matchedSignals.push(signal);
    }
  }

  return { score, matchedSignals };
}

function buildReason(persona: PersonaSeedDefinition, matchedSignals: string[]): string {
  if (matchedSignals.length === 0) return '';
  const signals = matchedSignals.slice(0, 3).join(', ');
  const more = matchedSignals.length > 3 ? ` (+${matchedSignals.length - 3} more)` : '';
  return `Matched stack signals: ${signals}${more}. ${persona.name} (${persona.role}) covers these domains.`;
}

// ---- Main -------------------------------------------------------------------

/**
 * Discover relevant persona seeds for a given tech stack.
 * Returns ranked results (highest score first), filtered to score > 0.
 */
export function discoverPersonas(
  input: DiscoverPersonasInput,
  seeds: PersonaSeedDefinition[] = PERSONA_SEEDS,
): DiscoveryResult[] {
  const { stackSignals, limit = 5, roleFilter } = input;

  if (stackSignals.length === 0) return [];

  const results: DiscoveryResult[] = [];

  for (const persona of seeds) {
    if (roleFilter && persona.role !== roleFilter) continue;

    const { score, matchedSignals } = scorePersona(persona, stackSignals);
    if (score === 0) continue;

    results.push({
      personaId: persona.id,
      name: persona.name,
      role: persona.role,
      score,
      matchedSignals,
      reason: buildReason(persona, matchedSignals),
    });
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}
