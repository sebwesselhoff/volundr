import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { autoRouteFromRows } from './auto-routing.js';

// --- Load the commit-pinned routing-rule seed and map to raw DB-row shape -----

interface SeedRule {
  workType: string;
  personaId: string;
  examples?: string[];
  negativeKeywords?: string[];
  confidence?: string;
  modulePattern?: string;
  priority?: number;
}

const seedPath = resolve(
  import.meta.dirname,
  '../../../../../framework/routing-rules/seed.json',
);
const seed: SeedRule[] = JSON.parse(readFileSync(seedPath, 'utf8'));

const rows = seed.map((r, i) => ({
  id: i + 1,
  work_type: r.workType,
  persona_id: r.personaId,
  examples: r.examples ? JSON.stringify(r.examples) : null,
  negative_keywords: r.negativeKeywords ? JSON.stringify(r.negativeKeywords) : null,
  confidence: r.confidence ?? 'medium',
  module_pattern: r.modulePattern ?? null,
  priority: r.priority ?? 0,
}));

const route = (description: string) => autoRouteFromRows(rows, { description }).personaId;

// --- Fixtures: the real CLEAR cards that mis-routed + strong-signal baselines --

interface Fixtures {
  misRouted: Array<{ id: string; description: string; accept: string[]; previousWrongPick: string }>;
  strongFoundation: Array<{ id: string; description: string; expect: string }>;
}
const fixtures: Fixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '__fixtures__/routing-cards.json'), 'utf8'),
);

describe('auto-routing — FRW-BL-024 mis-routing fix (replay against real CLEAR cards)', () => {
  // ISC-2: at least 5 of the 8 previously mis-routed cards now route correctly.
  it('corrects at least 5 of 8 previously mis-routed CLEAR cards', () => {
    const corrected = fixtures.misRouted.filter((c) => c.accept.includes(route(c.description) ?? ''));
    expect(corrected.length).toBeGreaterThanOrEqual(5);
  });

  // Per-card: routes into its acceptable set AND no longer returns the old wrong persona.
  it.each(fixtures.misRouted)(
    '$id routes into its acceptable set (not $previousWrongPick)',
    ({ description, accept, previousWrongPick }) => {
      const pick = route(description);
      expect(pick).not.toBe(previousWrongPick);
      expect(accept).toContain(pick);
    },
  );
});

describe('auto-routing — no regression on strong-signal foundation cards (ISC-4)', () => {
  it.each(fixtures.strongFoundation)('$id still routes to $expect', ({ description, expect: exp }) => {
    expect(route(description)).toBe(exp);
  });
});

describe('auto-routing — scorer mechanics', () => {
  const mkRow = (over: Partial<(typeof rows)[number]>) => ({
    id: 1,
    work_type: 'authentication',
    persona_id: 'auth-specialist',
    examples: JSON.stringify(['token', 'session', 'oauth']),
    negative_keywords: null,
    confidence: 'high',
    module_pattern: null,
    priority: 10,
    ...over,
  });

  it('word-boundary matching: "token" does NOT match inside "CancellationToken"', () => {
    const r = autoRouteFromRows([mkRow({})], {
      description: 'Implement IRepoFileEnumerator with a CancellationToken parameter',
    });
    expect(r.personaId).toBeNull(); // no whole-token match → no route
  });

  it('word-boundary matching: a standalone "token" DOES match', () => {
    const r = autoRouteFromRows([mkRow({})], { description: 'Refresh the access token on expiry' });
    expect(r.personaId).toBe('auth-specialist');
  });

  it('negative keywords suppress an otherwise-winning rule', () => {
    const withNeg = mkRow({ negative_keywords: JSON.stringify(['clone', 'octokit']) });
    const r = autoRouteFromRows([withNeg], {
      description: 'GitHub clone backend via Octokit, validate the OAuth token and session',
    });
    expect(r.personaId).toBeNull(); // suppressed despite oauth/token/session matches
  });

  it('punctuated tokens (.net, c#) match as whole tokens', () => {
    const dotnet = mkRow({
      work_type: 'dotnet',
      persona_id: 'dotnet-developer',
      examples: JSON.stringify(['.net', 'c#', 'asp.net']),
      negative_keywords: null,
      priority: 5,
    });
    expect(autoRouteFromRows([dotnet], { description: 'Port the analyzer to .net 8' }).personaId).toBe('dotnet-developer');
    expect(autoRouteFromRows([dotnet], { description: 'Write the c# mapper class' }).personaId).toBe('dotnet-developer');
  });
});
