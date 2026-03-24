import { Router } from 'express';
import { eq, and, desc, lt } from 'drizzle-orm';
import { getDb, schema } from '@vldr/db';
import type { TeamWithMembers } from '@vldr/shared';

const router = Router();

// GET /api/teams — list all teams
router.get('/teams', (req, res) => {
  const db = getDb();
  const statusFilter = req.query.status as string | undefined;

  let results;
  if (statusFilter === 'active') {
    results = db.select().from(schema.teams)
      .where(eq(schema.teams.status, 'active'))
      .orderBy(desc(schema.teams.createdAt)).all();
  } else {
    results = db.select().from(schema.teams)
      .orderBy(desc(schema.teams.createdAt)).all();
  }
  res.json(results);
});

// GET /api/teams/:id — single team with members
router.get('/teams/:id', (req, res) => {
  const db = getDb();
  const team = db.select().from(schema.teams)
    .where(eq(schema.teams.id, req.params.id)).get();
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const members = db.select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, team.id)).all();

  res.json({ ...team, members } as TeamWithMembers);
});

// GET /api/teams/:id/messages — messages with cursor pagination
router.get('/teams/:id/messages', (req, res) => {
  const db = getDb();
  const teamId = req.params.id;
  const agent = req.query.agent as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const before = req.query.before ? Number(req.query.before) : undefined;

  const conditions = [eq(schema.teamMessages.teamId, teamId)];
  if (agent) conditions.push(eq(schema.teamMessages.fromAgent, agent));
  if (before) conditions.push(lt(schema.teamMessages.id, before));

  const messages = db.select().from(schema.teamMessages)
    .where(and(...conditions))
    .orderBy(desc(schema.teamMessages.id))
    .limit(limit)
    .all();

  res.json(messages.map(m => ({ ...m, read: Boolean(m.read) })));
});

// GET /api/teams/:id/tasks — all tasks for a team
router.get('/teams/:id/tasks', (req, res) => {
  const db = getDb();
  const teamId = req.params.id;
  const tasks = db.select().from(schema.teamTasks)
    .where(eq(schema.teamTasks.teamId, teamId)).all();

  res.json(tasks.map(t => ({
    ...t,
    blocks: JSON.parse(t.blocks || '[]'),
    blockedBy: JSON.parse(t.blockedBy || '[]'),
  })));
});

export default router;
