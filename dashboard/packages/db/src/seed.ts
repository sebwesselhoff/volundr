import { getDb, schema } from './index.js';
import { randomUUID } from 'crypto';

const db = getDb();

db.insert(schema.projects).values({
  id: 'demo', name: 'Demo Project', path: '/tmp/demo',
  status: 'active', phase: 'implementation', reviewGateLevel: 2,
}).run();

db.insert(schema.agents).values({
  id: randomUUID(), projectId: 'demo', type: 'volundr', model: 'opus-4', status: 'running',
}).run();

const epicId = randomUUID();
db.insert(schema.epics).values({
  id: epicId, projectId: 'demo', name: 'Backend', domain: 'backend', color: '#7b7dbf', sortOrder: 0,
}).run();

db.insert(schema.cards).values({
  id: 'CARD-BE-001', epicId, projectId: 'demo', title: 'Express server setup', size: 'M', priority: 'P0', status: 'done',
}).run();

db.insert(schema.cards).values({
  id: 'CARD-BE-002', epicId, projectId: 'demo', title: 'REST API routes', size: 'L', priority: 'P1', status: 'in_progress', deps: '["CARD-BE-001"]',
}).run();

console.log('Seed complete.');
