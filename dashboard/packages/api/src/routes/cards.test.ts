/**
 * Integration tests for PATCH /cards/:id — persona_history auto-synthesis.
 *
 * Strategy: set VLDR_DB_PATH to a tmpfile BEFORE importing @vldr/db so the
 * module singleton uses an isolated SQLite file. Each test gets its own project,
 * epic, persona, and card seeded directly via drizzle to avoid cross-test
 * pollution.
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

// ---- MUST be set before any @vldr/db import ----
const TMP_DB = join(tmpdir(), `frw002-test-${Date.now()}.db`);
process.env['VLDR_DB_PATH'] = TMP_DB;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// These imports pull in the singleton DB; env must already be set above.
import { initDb, getDb, schema } from '@vldr/db';
import { eq, and } from 'drizzle-orm';
import cardsRouter from './cards.js';
import personasRouter from './personas.js';
import qualityRouter from './quality.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---- App setup ---------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', cardsRouter);
  app.use('/api', personasRouter);
  app.use('/api', qualityRouter);
  app.use(errorHandler);
  return app;
}

let app: ReturnType<typeof buildApp>;

// ---- Seed helpers ------------------------------------------------------------

interface SeedResult {
  projectId: string;
  epicId: string;
  personaId: string;
  cardId: string;
}

async function seedBase(): Promise<SeedResult> {
  const db = getDb();
  const projectId = `proj-${randomUUID().slice(0, 8)}`;
  const epicId = `epic-${randomUUID().slice(0, 8)}`;
  const personaId = `persona-${randomUUID().slice(0, 8)}`;
  const cardId = `CARD-TEST-${randomUUID().slice(0, 6).toUpperCase()}`;

  db.insert(schema.projects).values({
    id: projectId,
    name: 'Test Project',
    path: '/tmp/test',
    status: 'active',
    phase: 'build',
  }).run();

  db.insert(schema.epics).values({
    id: epicId,
    projectId,
    name: 'Test Epic',
    domain: 'backend',
  }).run();

  db.insert(schema.personas).values({
    id: personaId,
    name: 'Test Persona',
    role: 'developer',
    expertise: 'typescript,testing',
    style: '',
    modelPreference: 'auto',
    source: 'seed',
    status: 'active',
  }).run();

  db.insert(schema.cards).values({
    id: cardId,
    epicId,
    projectId,
    title: 'Test card for FRW-002',
    description: 'A card to test persona history synthesis.',
    status: 'in_progress',
    assignedPersonaId: personaId,
    isc: JSON.stringify([
      { criterion: 'Works end-to-end', passed: true, evidence: 'test line 1' },
    ]),
    filesCreated: JSON.stringify(['src/lib/test.ts']),
    filesModified: JSON.stringify(['src/routes/cards.ts']),
    deps: '[]',
    criteria: '',
    technicalNotes: '',
    branch: '',
    priority: 'P1',
  }).run();

  return { projectId, epicId, personaId, cardId };
}

const QUALITY_BODY = {
  completeness: 8,
  codeQuality: 8,
  formatCompliance: 8,
  correctness: 8,
  implementationType: 'agent',
  reviewType: 'self',
};

// ---- Lifecycle ---------------------------------------------------------------

beforeAll(async () => {
  await initDb();
  app = buildApp();
});

afterAll(() => {
  if (existsSync(TMP_DB)) rmSync(TMP_DB);
  const walPath = `${TMP_DB}-wal`;
  const shmPath = `${TMP_DB}-shm`;
  if (existsSync(walPath)) rmSync(walPath);
  if (existsSync(shmPath)) rmSync(shmPath);
});

// ---- Tests -------------------------------------------------------------------

// ISC-1 + ISC-4: happy path — exactly one 'card-close' row synthesised
describe('ISC-1: happy path — synthesis on card close', () => {
  it('inserts exactly one persona_history row with source=card-close', async () => {
    const { cardId, personaId } = await seedBase();

    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);

    const db = getDb();
    const rows = db
      .select()
      .from(schema.personaHistory)
      .where(
        and(
          eq(schema.personaHistory.personaId, personaId),
          eq(schema.personaHistory.cardId, cardId),
        ),
      )
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('card-close');
    expect(rows[0].entryType).toBe('learning');
    expect(rows[0].confidence).toBe(1.0);
  });
});

// ISC-2: organic row already exists — synthesis suppressed
describe('ISC-2: organic row exists — synthesis suppressed', () => {
  it('does NOT insert a card-close row when a history row already exists', async () => {
    const { cardId, personaId } = await seedBase();
    const db = getDb();

    // Pre-insert an organic row for this card+persona
    db.insert(schema.personaHistory).values({
      personaId,
      entryType: 'learning',
      content: 'I learned something organically.',
      projectId: 'test-proj',
      projectName: 'Test Project',
      cardId,
      stackTags: '[]',
      confidence: 1.0,
      source: 'organic',
    }).run();

    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);

    const rows = db
      .select()
      .from(schema.personaHistory)
      .where(
        and(
          eq(schema.personaHistory.personaId, personaId),
          eq(schema.personaHistory.cardId, cardId),
        ),
      )
      .all();

    // Only the one organic row; no synthetic row added
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('organic');
  });
});

// ISC-3: idempotent replay — second PATCH to done does not insert a second row
describe('ISC-3: idempotent replay', () => {
  it('does NOT insert a second row on re-PATCH to done', async () => {
    const { cardId, personaId } = await seedBase();

    // First PATCH — transitions to done and inserts synthetic row
    await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    // Second PATCH — card is already done, transition guard fires
    // (existing.status === 'done') so the synthesis block is skipped
    const res2 = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res2.status).toBe(200);

    const db = getDb();
    const rows = db
      .select()
      .from(schema.personaHistory)
      .where(
        and(
          eq(schema.personaHistory.personaId, personaId),
          eq(schema.personaHistory.cardId, cardId),
        ),
      )
      .all();

    expect(rows).toHaveLength(1); // still exactly one
  });
});

// ISC-5: null persona — synthesis skipped
describe('ISC-5: null persona — synthesis skipped', () => {
  it('does NOT insert a history row when assignedPersonaId is null', async () => {
    const db = getDb();
    const projectId = `proj-nullpersona-${randomUUID().slice(0, 8)}`;
    const epicId = `epic-np-${randomUUID().slice(0, 8)}`;
    const cardId = `CARD-NP-${randomUUID().slice(0, 6).toUpperCase()}`;

    db.insert(schema.projects).values({
      id: projectId, name: 'NP Project', path: '/tmp/np',
      status: 'active', phase: 'build',
    }).run();
    db.insert(schema.epics).values({
      id: epicId, projectId, name: 'NP Epic', domain: 'backend',
    }).run();
    db.insert(schema.cards).values({
      id: cardId, epicId, projectId,
      title: 'Card with no persona',
      description: 'No persona assigned.',
      status: 'in_progress',
      assignedPersonaId: null,
      isc: JSON.stringify([{ criterion: 'Done', passed: true, evidence: null }]),
      deps: '[]',
      criteria: '',
      technicalNotes: '',
      branch: '',
      filesCreated: '[]',
      filesModified: '[]',
      priority: 'P1',
    }).run();

    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);

    const rows = db
      .select()
      .from(schema.personaHistory)
      .where(eq(schema.personaHistory.cardId, cardId))
      .all();

    expect(rows).toHaveLength(0);
  });
});

// FRW-BL-018 ISC-4: PATCH with a different reviewType than the existing score
// seeds a reviewer score via POST /api/quality, then PATCHes with a self-typed
// quality body — both rows must persist independently.
describe('FRW-BL-018 ISC-4: two reviewTypes coexist after PATCH with a different reviewType', () => {
  it('leaves both self and reviewer rows intact with correct weighted scores', async () => {
    const { cardId } = await seedBase();
    const db = getDb();

    // Pre-seed a reviewer score via POST /api/quality
    const reviewerRes = await request(app)
      .post('/api/quality')
      .send({
        cardId,
        completeness: 9,
        codeQuality: 9,
        formatCompliance: 8,
        correctness: 8,
        implementationType: 'agent',
        reviewType: 'reviewer',
      });
    // POST /api/quality returns 201 on insert, 200 on update — new card → 201
    expect(reviewerRes.status).toBe(201);

    // PATCH card to done with a SELF-typed quality body
    const patchRes = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({
        status: 'done',
        quality: {
          completeness: 7,
          codeQuality: 7,
          formatCompliance: 6,
          correctness: 6,
          implementationType: 'agent',
          reviewType: 'self',
        },
      });
    expect(patchRes.status).toBe(200);

    // Both rows must exist independently
    const rows = db.select().from(schema.qualityScores)
      .where(eq(schema.qualityScores.cardId, cardId)).all();

    expect(rows).toHaveLength(2);

    const selfRow = rows.find(r => r.reviewType === 'self');
    const reviewerRow = rows.find(r => r.reviewType === 'reviewer');

    expect(selfRow).toBeDefined();
    expect(reviewerRow).toBeDefined();

    // self: (7*3 + 7*3 + 6*2 + 6*2) / 10 = (21+21+12+12)/10 = 66/10 = 6.6
    expect(selfRow!.weightedScore).toBeCloseTo(6.6, 5);

    // reviewer: (9*3 + 9*3 + 8*2 + 8*2) / 10 = (27+27+16+16)/10 = 86/10 = 8.6
    expect(reviewerRow!.weightedScore).toBeCloseTo(8.6, 5);
  });
});

// FRW-BL-018 ISC-5: regression — PATCH with SAME reviewType updates in place
describe('FRW-BL-018 ISC-5: PATCH with same reviewType updates row in place', () => {
  it('updates the existing row without UNIQUE violation or duplicate row', async () => {
    const { cardId } = await seedBase();
    const db = getDb();

    // First PATCH — inserts a self row
    const first = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({
        status: 'done',
        quality: {
          completeness: 6,
          codeQuality: 6,
          formatCompliance: 6,
          correctness: 6,
          implementationType: 'agent',
          reviewType: 'self',
        },
      });
    expect(first.status).toBe(200);

    // Second PATCH — same reviewType, new scores (card is already done so status unchanged)
    const second = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({
        status: 'done',
        quality: {
          completeness: 8,
          codeQuality: 8,
          formatCompliance: 8,
          correctness: 8,
          implementationType: 'agent',
          reviewType: 'self',
        },
      });
    expect(second.status).toBe(200);

    // Must still be exactly one row for this card
    const rows = db.select().from(schema.qualityScores)
      .where(eq(schema.qualityScores.cardId, cardId)).all();

    expect(rows).toHaveLength(1);
    expect(rows[0].reviewType).toBe('self');

    // Score must reflect the second PATCH values: (8*3+8*3+8*2+8*2)/10 = 80/10 = 8.0
    expect(rows[0].weightedScore).toBeCloseTo(8.0, 5);
  });
});

// ISC-6: extractSkills integration — synthetic row is included and processed
describe('ISC-6: extractSkills integration with synthetic row', () => {
  it('includes synthetic row in includedEntryCount when confidence >= threshold', async () => {
    const { cardId, personaId } = await seedBase();

    // Close the card → synthetic row inserted
    const patchRes = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });
    expect(patchRes.status).toBe(200);

    // Verify the row exists
    const db = getDb();
    const rows = db
      .select()
      .from(schema.personaHistory)
      .where(
        and(
          eq(schema.personaHistory.personaId, personaId),
          eq(schema.personaHistory.cardId, cardId),
        ),
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].entryType).toBe('learning');
    expect(rows[0].confidence).toBeGreaterThanOrEqual(0.5); // above default threshold

    // Call extract-skills dry-run
    const extractRes = await request(app)
      .post(`/api/personas/${personaId}/extract-skills`)
      .send({ dryRun: true });

    expect(extractRes.status).toBe(200);
    expect(extractRes.body.dryRun).toBe(true);
    // The synthetic row is entryType='learning' with confidence=1.0 — it passes the
    // eligibility filter and (since MIN_GROUP_SIZE=1) survives grouping into a skill.
    // That means it must appear in includedEntryCount AND in the skills array.
    expect(extractRes.body.includedEntryCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(extractRes.body.skills)).toBe(true);
    expect(extractRes.body.skills.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- FRW-BL-014C3: warn-only portal-walk on done transition -------------------

// Seed a project whose `path` points to a temp dir containing a Next.js App Router
// tree, plus a card whose ISC carries a portal annotation.
function seedPortalCard(opts: {
  route: string;
  pageContent: string | null; // null => do not create the page file (unimplemented)
  expectedExports?: string[];
}): { projectId: string; cardId: string } {
  const db = getDb();
  const projectId = `proj-portal-${randomUUID().slice(0, 8)}`;
  const epicId = `epic-portal-${randomUUID().slice(0, 8)}`;
  const cardId = `CARD-PORTAL-${randomUUID().slice(0, 6).toUpperCase()}`;
  const projectPath = mkdtempSync(join(tmpdir(), 'portal-proj-'));

  if (opts.pageContent !== null) {
    const segments = opts.route.split('/').filter(Boolean);
    const dir = join(projectPath, 'app', ...segments);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'page.tsx'), opts.pageContent);
  }

  db.insert(schema.projects).values({
    id: projectId, name: 'Portal Project', path: projectPath, status: 'active', phase: 'build',
  }).run();
  db.insert(schema.epics).values({ id: epicId, projectId, name: 'Portal Epic', domain: 'frontend' }).run();
  db.insert(schema.cards).values({
    id: cardId, epicId, projectId,
    title: 'Portal card',
    description: 'Card with a portal-annotated ISC criterion.',
    status: 'in_progress',
    assignedPersonaId: null,
    isc: JSON.stringify([
      {
        criterion: `Route ${opts.route} is implemented`,
        passed: true,
        evidence: 'verified',
        portal: { route: opts.route, expectedExports: opts.expectedExports ?? ['default'] },
      },
    ]),
    deps: '[]', criteria: '', technicalNotes: '', branch: '',
    filesCreated: '[]', filesModified: '[]', priority: 'P1',
  }).run();

  return { projectId, cardId };
}

// ~26 non-blank lines — comfortably above the default minLines of 20.
const FULL_PAGE_TSX = `import { Suspense } from 'react';

export const metadata = { title: 'Reports' };

function Header() {
  return <header><h1>Reports</h1></header>;
}

function Footer() {
  return <footer>done</footer>;
}

export default function ReportsPage() {
  const rows = [1, 2, 3, 4, 5];
  const total = rows.reduce((a, b) => a + b, 0);
  const avg = total / rows.length;
  return (
    <main>
      <Header />
      <p>Total: {total} Avg: {avg}</p>
      <ul>
        {rows.map((r) => (<li key={r}>Row {r}</li>))}
      </ul>
      <Footer />
    </main>
  );
}
`;

describe('FRW-BL-014C3 ISC-4: stub portal page → done transition + block finding in response', () => {
  it('transitions to done AND returns a block-severity portalWalkFinding', async () => {
    const { cardId } = seedPortalCard({ route: '/parity', pageContent: 'export default function P(){return null}\n' });

    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done'); // NON-BLOCKING: still transitions
    expect(Array.isArray(res.body.portalWalkFindings)).toBe(true);
    expect(res.body.portalWalkFindings.length).toBeGreaterThanOrEqual(1);
    expect(res.body.portalWalkFindings.some((f: { severity: string }) => f.severity === 'block')).toBe(true);
  });
});

describe('FRW-BL-014C3 ISC-1: portal_walk_warning event logged with findings', () => {
  it('logs a portal_walk_warning event for the card', async () => {
    const { cardId, projectId } = seedPortalCard({ route: '/parity', pageContent: 'export default function P(){return null}\n' });

    await request(app).patch(`/api/cards/${cardId}`).send({ status: 'done', quality: QUALITY_BODY });

    const db = getDb();
    const events = db.select().from(schema.events)
      .where(and(eq(schema.events.cardId, cardId), eq(schema.events.type, 'portal_walk_warning'))).all();
    expect(events.length).toBe(1);
    expect(events[0].detail).toMatch(/block:1/);
    void projectId;
  });
});

describe('FRW-BL-014C3 ISC-5: full portal page → done with no findings', () => {
  it('transitions to done with an empty portalWalkFindings array', async () => {
    const { cardId } = seedPortalCard({
      route: '/reports',
      pageContent: FULL_PAGE_TSX,
      expectedExports: ['default', 'metadata'],
    });

    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.portalWalkFindings).toEqual([]);
  });
});

describe('FRW-BL-014C3 ISC-3: non-portal card skips the scan entirely', () => {
  it('omits portalWalkFindings from the response when no ISC criterion has a portal annotation', async () => {
    const { cardId } = await seedBase(); // ISC has no portal annotation
    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .send({ status: 'done', quality: QUALITY_BODY });

    expect(res.status).toBe(200);
    expect(res.body.portalWalkFindings).toBeUndefined();
  });
});
