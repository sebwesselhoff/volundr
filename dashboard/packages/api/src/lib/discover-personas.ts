/**
 * discover-personas.ts — persona auto-discovery from tech stack signals
 *
 * Scores persona seeds against a list of tech stack keywords and returns
 * ranked recommendations.  Pure function — no DB access, no HTTP.
 *
 * Three-tier discovery (handled by the route, not this module):
 *   1. User-created personas (DB, source='user') — highest priority
 *   2. Pack-installed personas (DB, source='pack') — medium priority
 *   3. Built-in roster (PERSONA_SEEDS below) — always available
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
  expertiseKeywords: string[];
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
  stackSignals: string[];
  limit?: number;
  roleFilter?: string;
}

// ---- Built-in Persona Roster ------------------------------------------------
//
// The default lineup — curated, battle-tested, always available.
// Named in Old Norse tradition to match the Volundr framework theme.
// Users can override any of these by creating a persona with the same ID.

export const PERSONA_SEEDS: PersonaSeedDefinition[] = [

  // ── Architect ────────────────────────────────────────────────────────────────
  // Defines system structure before code is written. Service boundaries, API
  // contracts, data flows, architectural patterns. Reviews for drift.
  // Does NOT: write production code, make UI decisions, gatekeep merges.
  {
    id: 'architect',
    name: 'Týr Lawbringer',
    role: 'architect',
    expertiseKeywords: [
      'system design', 'api contract', 'service boundaries', 'dependency analysis',
      'data flow', 'scalability', 'event-driven', 'monolith', 'microservices',
      'domain-driven design', 'ddd', 'bounded context', 'cqrs', 'event sourcing',
      'saga pattern', 'message queue', 'kafka', 'rabbitmq', 'grpc', 'openapi',
      'c4 model', 'adr', 'hexagonal architecture', 'clean architecture',
      'api gateway', 'circuit breaker', 'architecture',
    ],
  },

  // ── Auth & Identity Specialist ──────────────────────────────────────────────
  // Builds authentication and authorization systems. OAuth2 flows, JWT lifecycle,
  // session management, RBAC/ABAC, MFA. Understands token security deeply.
  // Does NOT: own general backend logic, write UI, manage infrastructure.
  {
    id: 'auth-specialist',
    name: 'Heimdall Watchfire',
    role: 'developer',
    expertiseKeywords: [
      'oauth2', 'oidc', 'jwt', 'rbac', 'abac', 'msal', 'session', 'pkce',
      'token', 'mfa', 'saml', 'auth', 'authentication', 'authorization',
      'passport', 'next-auth', 'auth.js', 'clerk', 'supabase auth',
      'refresh token', 'access control', 'identity', 'sso', 'ldap',
    ],
  },

  // ── Database Engineer ───────────────────────────────────────────────────────
  // Designs schemas, writes migrations, optimizes queries, manages indexes.
  // Expert in ORMs and raw SQL. Ensures data integrity and performance.
  // Does NOT: own application logic, build UIs, manage deployment.
  {
    id: 'database-engineer',
    name: 'Mímir Deepwell',
    role: 'developer',
    expertiseKeywords: [
      'sql', 'sqlite', 'postgresql', 'postgres', 'mysql', 'drizzle', 'prisma',
      'query', 'schema', 'migration', 'index', 'normalization', 'orm',
      'database', 'db', 'knex', 'typeorm', 'sequelize', 'better-sqlite3',
      'connection pooling', 'transaction', 'foreign key', 'constraint',
      'mongodb', 'redis', 'elasticsearch',
    ],
  },

  // ── Data Engineer ───────────────────────────────────────────────────────────
  // Builds ETL pipelines, data transformations, integration flows.
  // Maps between systems (ERP, CRM, APIs). Validates and cleans data.
  // Does NOT: build user-facing features, own database schema design, manage infra.
  {
    id: 'data-engineer',
    name: 'Skuld Threadweaver',
    role: 'developer',
    expertiseKeywords: [
      'etl', 'pipeline', 'csv', 'xml', 'json', 'mapping', 'validation',
      'transformation', 'cosi', 'infor', 'sap', 'data', 'integration',
      'data flow', 'batch processing', 'stream processing', 'apache beam',
      'airflow', 'dbt', 'fivetran', 'data quality', 'schema validation',
    ],
  },

  // ── DevOps & Infrastructure ─────────────────────────────────────────────────
  // CI/CD pipelines, containers, deployment automation, monitoring.
  // Bridges development and operations. Infrastructure as code.
  // Does NOT: write application features, own database schemas, make UX decisions.
  {
    id: 'devops-infra',
    name: 'Brokkr Forgehand',
    role: 'devops-engineer',
    expertiseKeywords: [
      'docker', 'docker compose', 'ci', 'cd', 'github actions', 'shell', 'azure',
      'gcp', 'aws', 'iac', 'nginx', 'deployment', 'infrastructure', 'devops',
      'kubernetes', 'k8s', 'terraform', 'pulumi', 'ansible', 'helm',
      'monitoring', 'grafana', 'prometheus', 'datadog', 'log aggregation',
      'container registry', 'blue-green', 'canary', 'rollback',
    ],
  },

  // ── Documentation Engineer ──────────────────────────────────────────────────
  // Technical writing: API docs, architecture docs, READMEs, runbooks, ADRs.
  // Makes complex systems understandable. Maintains docs as code evolves.
  // Does NOT: write production code, make architecture decisions, manage deployment.
  {
    id: 'documentation-engineer',
    name: 'Saga Storyteller',
    role: 'content',
    expertiseKeywords: [
      'openapi', 'swagger', 'adr', 'runbook', 'readme', 'docs', 'documentation',
      'changelog', 'api reference', 'technical writing', 'onboarding',
      'markdown', 'docusaurus', 'storybook', 'typedoc', 'jsdoc',
    ],
  },

  // ── Fullstack Web Developer ─────────────────────────────────────────────────
  // End-to-end web development: TypeScript, React, Node.js, APIs, databases.
  // Can work across the entire stack. The generalist workhorse.
  // Does NOT: own specialized domains (security, infra, ML), make architecture decisions.
  {
    id: 'fullstack-web',
    name: 'Baldr Brightblade',
    role: 'developer',
    expertiseKeywords: [
      'typescript', 'javascript', 'react', 'nextjs', 'next.js', 'node', 'nodejs',
      'express', 'fastify', 'hono', 'tailwind', 'rest', 'trpc', 'tRPC',
      'frontend', 'backend', 'fullstack', 'web', 'vite', 'webpack',
      'html', 'css', 'dom', 'fetch', 'axios', 'zustand', 'redux',
    ],
  },

  // ── Migration Engineer ──────────────────────────────────────────────────────
  // Schema evolution, zero-downtime migrations, data backfills.
  // Expand-contract pattern, rollback strategies, version compatibility.
  // Does NOT: design new schemas from scratch, own application logic.
  {
    id: 'migration-engineer',
    name: 'Rán Tidecaller',
    role: 'developer',
    expertiseKeywords: [
      'schema evolution', 'backfill', 'zero-downtime', 'rollback', 'expand-contract',
      'flyway', 'liquibase', 'migration', 'drizzle', 'data migration',
      'database versioning', 'backward compatible', 'forward compatible',
    ],
  },

  // ── Security Reviewer ───────────────────────────────────────────────────────
  // Code-level security audit. OWASP Top 10, injection, XSS, CSRF, secrets.
  // Reviews code for vulnerabilities, not architecture for threat models.
  // Does NOT: write features, manage infrastructure, own auth implementation.
  {
    id: 'security-reviewer',
    name: 'Víðarr Silentward',
    role: 'reviewer',
    expertiseKeywords: [
      'owasp', 'auth audit', 'jwt security', 'secret', 'pii', 'vulnerability',
      'injection', 'cors', 'csp', 'security', 'pentest', 'xss', 'csrf',
      'sql injection', 'command injection', 'path traversal', 'ssrf',
      'dependency audit', 'npm audit', 'snyk', 'sonarqube',
    ],
  },

  // ── QA / Test Engineer ──────────────────────────────────────────────────────
  // Test strategy, test automation, coverage analysis. Unit, integration, E2E.
  // Writes tests that catch real bugs, not tests that inflate coverage.
  // Does NOT: write production features, own deployment, make architecture decisions.
  {
    id: 'test-engineer',
    name: 'Forseti Truthseeker',
    role: 'qa-engineer',
    expertiseKeywords: [
      'test', 'unit test', 'integration test', 'e2e', 'playwright', 'cypress',
      'vitest', 'jest', 'coverage', 'mock', 'stub', 'xunit', 'qa', 'quality',
      'test strategy', 'test plan', 'regression', 'snapshot test',
      'msw', 'testing library', 'react testing library', 'nunit', 'pytest',
    ],
  },

  // ── Frontend / UI Specialist ────────────────────────────────────────────────
  // CSS mastery, responsive design, animations, design system implementation.
  // Makes interfaces feel polished and intentional. Component library builder.
  // Does NOT: own backend logic, manage databases, write API endpoints.
  {
    id: 'frontend-ui',
    name: 'Iðunn Goldleaf',
    role: 'designer',
    expertiseKeywords: [
      'css', 'scss', 'sass', 'styled-components', 'css modules', 'tailwind',
      'responsive', 'mobile-first', 'flexbox', 'grid', 'animation',
      'framer motion', 'gsap', 'transition', 'keyframes', 'design system',
      'component library', 'storybook', 'figma', 'tokens', 'theming',
      'dark mode', 'light mode', 'ui', 'ux', 'frontend',
    ],
  },

  // ── API Designer ────────────────────────────────────────────────────────────
  // REST, GraphQL, gRPC contract design. Versioning, pagination, rate limiting.
  // Defines the contract between services. Thinks in resources and operations.
  // Does NOT: implement business logic, build UIs, manage databases directly.
  {
    id: 'api-designer',
    name: 'Hermóðr Swiftmessage',
    role: 'developer',
    expertiseKeywords: [
      'rest', 'restful', 'graphql', 'grpc', 'protobuf', 'api design',
      'openapi', 'swagger', 'api versioning', 'pagination', 'rate limiting',
      'hateoas', 'json:api', 'webhook', 'websocket', 'sse',
      'api gateway', 'api contract', 'schema-first', 'code-first',
    ],
  },

  // ── Python Developer ────────────────────────────────────────────────────────
  // Python ecosystem: FastAPI, Django, Flask, scripting, automation.
  // Data processing, CLI tools, backend services. Pythonic patterns.
  // Does NOT: own frontend, manage infrastructure (unless scripting it).
  {
    id: 'python-developer',
    name: 'Sigyn Steadfast',
    role: 'developer',
    expertiseKeywords: [
      'python', 'fastapi', 'django', 'flask', 'pydantic', 'sqlalchemy',
      'alembic', 'poetry', 'pip', 'pytest', 'asyncio', 'uvicorn',
      'pandas', 'numpy', 'celery', 'redis', 'scripting', 'automation',
      'type hints', 'mypy', 'ruff', 'black',
    ],
  },

  // ── Mobile Developer ────────────────────────────────────────────────────────
  // Cross-platform and native mobile: React Native, Flutter, Swift, Kotlin.
  // Mobile-specific UX patterns, offline-first, push notifications.
  // Does NOT: own backend APIs, manage web infrastructure, design databases.
  {
    id: 'mobile-developer',
    name: 'Sleipnir Swiftfoot',
    role: 'developer',
    expertiseKeywords: [
      'react native', 'flutter', 'swift', 'swiftui', 'kotlin', 'jetpack compose',
      'expo', 'ios', 'android', 'mobile', 'app store', 'play store',
      'push notification', 'deep linking', 'offline-first', 'sqlite',
      'native module', 'bridge', 'capacitor', 'ionic',
    ],
  },

  // ── Cloud / Serverless Specialist ───────────────────────────────────────────
  // Cloud-native patterns: Lambda, edge functions, managed services.
  // Thinks in events, triggers, and pay-per-use. Cold starts, concurrency.
  // Does NOT: manage on-prem infrastructure, build monolithic apps, own frontend.
  {
    id: 'cloud-serverless',
    name: 'Skaði Cloudpiercer',
    role: 'developer',
    expertiseKeywords: [
      'lambda', 'aws lambda', 'azure functions', 'cloudflare workers', 'edge',
      'serverless', 'vercel', 'netlify', 'deno deploy', 'cloud run',
      'step functions', 'event bridge', 'sqs', 'sns', 'pub/sub',
      'cold start', 'concurrency', 'cloud-native', 'faas',
      'dynamodb', 'firestore', 'neon', 'planetscale', 'supabase',
    ],
  },

  // ── Performance Engineer ────────────────────────────────────────────────────
  // Profiling, load testing, caching strategy, bundle optimization.
  // Finds and fixes bottlenecks. Measures before and after.
  // Does NOT: build new features, own product decisions, manage deployment.
  {
    id: 'performance-engineer',
    name: 'Magni Irongrip',
    role: 'reviewer',
    expertiseKeywords: [
      'performance', 'profiling', 'load testing', 'caching', 'cdn',
      'bundle size', 'tree shaking', 'code splitting', 'lazy loading',
      'core web vitals', 'lighthouse', 'lcp', 'fid', 'cls',
      'k6', 'artillery', 'jmeter', 'flamegraph', 'memory leak',
      'database query optimization', 'n+1', 'connection pooling',
      'redis cache', 'memoization', 'debounce', 'throttle',
    ],
  },

  // ── AI / ML Engineer ────────────────────────────────────────────────────────
  // ML pipelines, LLM integration, embeddings, vector databases, fine-tuning.
  // Bridges AI capabilities with application code. Prompt engineering.
  // Does NOT: own general backend, build UI, manage non-ML infrastructure.
  {
    id: 'ai-ml-engineer',
    name: 'Huginn Thoughtwing',
    role: 'developer',
    expertiseKeywords: [
      'machine learning', 'ml', 'llm', 'embeddings', 'vector database',
      'pinecone', 'weaviate', 'chromadb', 'rag', 'retrieval augmented',
      'fine-tuning', 'lora', 'prompt engineering', 'langchain', 'llamaindex',
      'openai', 'anthropic', 'claude', 'gpt', 'huggingface', 'transformers',
      'pytorch', 'tensorflow', 'scikit-learn', 'mlflow', 'wandb',
      'ai', 'neural network', 'classification', 'regression',
    ],
  },

  // ── Accessibility Specialist ────────────────────────────────────────────────
  // WCAG compliance, screen reader testing, keyboard navigation, ARIA patterns.
  // Ensures software is usable by everyone. Audits and fixes a11y issues.
  // Does NOT: own visual design, build features, manage backend.
  {
    id: 'accessibility-specialist',
    name: 'Höðr Allseer',
    role: 'reviewer',
    expertiseKeywords: [
      'accessibility', 'a11y', 'wcag', 'aria', 'screen reader', 'nvda',
      'voiceover', 'jaws', 'keyboard navigation', 'tab order', 'focus management',
      'color contrast', 'alt text', 'semantic html', 'landmark',
      'axe', 'lighthouse accessibility', 'pa11y', 'role', 'aria-label',
      'skip link', 'live region', 'accessible name',
    ],
  },

  // ── Researcher ──────────────────────────────────────────────────────────────
  // External API research, documentation analysis, endpoint mapping.
  // Investigates unknown systems, reads docs, produces integration guides.
  // Does NOT: implement code, make architecture decisions, own deployment.
  {
    id: 'researcher',
    name: 'Muninn Farseeker',
    role: 'researcher',
    expertiseKeywords: [
      'api research', 'documentation', 'endpoint mapping', 'integration guide',
      'sdk analysis', 'swagger', 'postman', 'curl', 'api exploration',
      'reverse engineering', 'protocol analysis', 'rate limits',
      'authentication flow', 'webhook', 'event schema',
    ],
  },

  // ── .NET Developer ──────────────────────────────────────────────────────────
  // C#, ASP.NET Core, Entity Framework, Azure integration. Enterprise patterns.
  // SOLID principles, dependency injection, middleware pipelines.
  // Does NOT: own frontend (unless Blazor), manage non-.NET infrastructure.
  {
    id: 'dotnet-developer',
    name: 'Eitri Runecaster',
    role: 'developer',
    expertiseKeywords: [
      'csharp', 'c#', 'dotnet', '.net', 'asp.net', 'asp.net core',
      'entity framework', 'ef core', 'linq', 'blazor', 'maui',
      'nuget', 'azure', 'azure devops', 'dapper', 'mediatr',
      'dependency injection', 'middleware', 'minimal api', 'web api',
      'xunit', 'nunit', 'moq', 'fluentassertions',
    ],
  },

  // ── SEO / Growth Engineer ───────────────────────────────────────────────────
  // Technical SEO: meta tags, structured data, sitemaps, Core Web Vitals.
  // Makes pages discoverable and fast. Schema.org, Open Graph, analytics.
  // Does NOT: write marketing copy, own backend logic, manage infrastructure.
  {
    id: 'seo-growth',
    name: 'Freyja Goldseeker',
    role: 'developer',
    expertiseKeywords: [
      'seo', 'meta tags', 'structured data', 'open graph', 'sitemap',
      'core web vitals', 'analytics', 'schema.org', 'lighthouse',
      'page speed', 'google search console', 'robots.txt', 'canonical',
      'og:image', 'twitter card', 'json-ld', 'rich snippet',
      'crawl budget', 'indexing', 'next-seo', 'hreflang',
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
        break;
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
