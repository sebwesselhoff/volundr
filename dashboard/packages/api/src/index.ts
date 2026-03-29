import express from 'express';
import { createServer } from 'http';
import { copyFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { API_PORT } from '@vldr/shared';
import { initDb, getDb, getRawSqlite, getSchemaVersion, schema } from '@vldr/db';
import { eq, and, lt, ne } from 'drizzle-orm';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { setupWebSocket, getClients } from './ws/server.js';
import { handleIncomingMessage } from './ws/handlers.js';
import { broadcastToBrowsers } from './ws/broadcast.js';
import { seedCommunityLessons } from './seed-lessons.js';
import { seedRoutingRules } from './seed-routing-rules.js';
import { TeamSyncService } from './services/team-sync.js';
import projectsRouter from './routes/projects.js';
import epicsRouter from './routes/epics.js';
import cardsRouter from './routes/cards.js';
import agentsRouter from './routes/agents.js';
import eventsRouter from './routes/events.js';
import qualityRouter from './routes/quality.js';
import lessonsRouter from './routes/lessons.js';
import metricsRouter from './routes/metrics.js';
import { commandsRouter } from './routes/commands.js';
import logsRouter from './routes/logs.js';
import journalRouter from './routes/journal.js';
import sessionSummariesRouter from './routes/session-summaries.js';
import teamsRouter from './routes/teams.js';
import personasRouter from './routes/personas.js';
import routingRulesRouter from './routes/routing-rules.js';
import directivesRouter from './routes/directives.js';
import skillsRouter from './routes/skills.js';
import economyRouter from './routes/economy.js';
import reviewerLockoutsRouter from './routes/reviewer-lockouts.js';
import ceremoniesRouter from './routes/ceremonies.js';
import packsRouter from './routes/packs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Matches the DB path used by the db package (dashboard/data/the-forge.db)
const DB_PATH = process.env.VLDR_DB_PATH || resolve(__dirname, '..', '..', '..', 'data', 'the-forge.db');

const app = express();
const server = createServer(app);

app.use(cors);
app.use(express.json());

// WebSocket
const wss = setupWebSocket(server, handleIncomingMessage);

// Health check
const startTime = Date.now();
app.get('/api/health', (_req, res) => {
  let dbConnected = false;
  try {
    getDb();
    dbConnected = true;
  } catch { /* db down */ }

  res.json({
    status: 'ok',
    uptime: Date.now() - startTime,
    dbConnected,
    wsClients: getClients().size,
  });
});

// DB status — reports schema version, file sizes (for vldr-doctor)
app.get('/api/db/status', (_req, res) => {
  try {
    const sqlite = getRawSqlite();
    const schemaVersion = getSchemaVersion();
    const dbSize = existsSync(DB_PATH) ? statSync(DB_PATH).size : 0;
    const walSize = existsSync(`${DB_PATH}-wal`) ? statSync(`${DB_PATH}-wal`).size : 0;
    res.json({ schemaVersion, dbSize, walSize, journalMode: 'wal' });
  } catch (err) {
    res.status(503).json({ error: 'Database not ready', detail: (err as Error).message });
  }
});

// DB backup — checkpoint WAL then copy DB file
app.post('/api/db/backup', (_req, res) => {
  try {
    const sqlite = getRawSqlite();
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${DB_PATH}.backup-${ts}`;
    copyFileSync(DB_PATH, backupPath);
    res.json({ backup: backupPath, size: statSync(backupPath).size });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed', detail: (err as Error).message });
  }
});

// REST routes
app.use('/api/projects', projectsRouter);
app.use('/api', epicsRouter);
app.use('/api', cardsRouter);
app.use('/api', agentsRouter);
app.use('/api', eventsRouter);
app.use('/api', qualityRouter);
app.use('/api', lessonsRouter);
app.use('/api', metricsRouter);
app.use('/api', commandsRouter);
app.use('/api', logsRouter);
app.use('/api', journalRouter);
app.use('/api', sessionSummariesRouter);
app.use('/api', teamsRouter);
app.use('/api', personasRouter);
app.use('/api', routingRulesRouter);
app.use('/api', directivesRouter);
app.use('/api', skillsRouter);
app.use('/api', economyRouter);
app.use('/api', reviewerLockoutsRouter);
app.use('/api', ceremoniesRouter);
app.use('/api', packsRouter);

// Error handler (must be after routes)
app.use(errorHandler);

let teamSync: TeamSyncService | null = null;

function flushWal(): void {
  try {
    const sqlite = getRawSqlite();
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch { /* db may not be initialized yet */ }
}

// Graceful shutdown — flush WAL, release port before tsx restarts us
async function shutdown() {
  flushWal();
  if (teamSync) await teamSync.stop();
  server.close(() => process.exit(0));
  // Force exit after 2s if close hangs
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// tsx watch sends SIGUSR2 before restart — release port immediately
process.on('SIGUSR2', async () => {
  flushWal();
  if (teamSync) await teamSync.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
});

// Handle EADDRINUSE — wait for old process to die, then retry with backoff
let retryCount = 0;
const MAX_RETRIES = 5;

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
    retryCount++;
    const delay = retryCount * 1000;
    console.log(`Port ${API_PORT} in use, retry ${retryCount}/${MAX_RETRIES} in ${delay}ms...`);
    setTimeout(() => {
      server.close();
      server.listen(API_PORT);
    }, delay);
  } else if (err.code === 'EADDRINUSE') {
    console.log(`Port ${API_PORT} still in use after ${MAX_RETRIES} retries — exiting. Previous process will serve.`);
    process.exit(0);
  } else {
    throw err;
  }
});

// Agent TTL cleanup — mark agents running for >4 hours as orphaned
const AGENT_TTL_MS = 4 * 60 * 60 * 1000;
const AGENT_TTL_CHECK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 minutes

function runAgentTtlCleanup() {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - AGENT_TTL_MS).toISOString();
    const staleAgents = db.select().from(schema.agents)
      .where(and(
        eq(schema.agents.status, 'running'),
        lt(schema.agents.startedAt, cutoff),
        ne(schema.agents.type, 'volundr'),
      ))
      .all();
    if (staleAgents.length > 0) {
      const now = new Date().toISOString();
      db.update(schema.agents)
        .set({ status: 'completed', completedAt: now })
        .where(and(
          eq(schema.agents.status, 'running'),
          lt(schema.agents.startedAt, cutoff),
          ne(schema.agents.type, 'volundr'),
        ))
        .run();
      console.log(`[API] TTL cleanup: marked ${staleAgents.length} orphaned agent(s) as completed`);
    }
  } catch (err) {
    console.warn('[API] TTL cleanup error:', (err as Error).message);
  }
}

server.listen(API_PORT, () => {
  retryCount = 0;
  console.log(`MC Dashboard API running on http://localhost:${API_PORT}`);
  // Initialize DB (runs migrations) then start services
  initDb().then((db) => {
    // Seed community lessons from framework seed file
    seedCommunityLessons();
    seedRoutingRules();
    // Start TeamSyncService with graceful degradation
    teamSync = new TeamSyncService(db, broadcastToBrowsers);
    teamSync.start().then(() => {
      console.log('[API] TeamSyncService started — watching for Agent Teams');
    }).catch((err: Error) => {
      console.warn('[API] TeamSyncService failed to start:', err.message);
      teamSync = null;
    });
    // Start agent TTL cleanup interval
    setInterval(runAgentTtlCleanup, AGENT_TTL_CHECK_INTERVAL_MS);
    runAgentTtlCleanup(); // Run once on boot
  }).catch((err: Error) => {
    console.error('[API] Failed to initialize database:', err.message);
    process.exit(1);
  });
});

export { app, server };
