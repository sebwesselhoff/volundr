import express from 'express';
import { createServer } from 'http';
import { API_PORT } from '@vldr/shared';
import { getDb, schema } from '@vldr/db';
import { eq, and, lt, ne } from 'drizzle-orm';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { setupWebSocket, getClients } from './ws/server.js';
import { handleIncomingMessage } from './ws/handlers.js';
import { broadcastToBrowsers } from './ws/broadcast.js';
import { seedCommunityLessons } from './seed-lessons.js';
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

// Error handler (must be after routes)
app.use(errorHandler);

let teamSync: TeamSyncService | null = null;

// Graceful shutdown — release port before tsx restarts us
async function shutdown() {
  if (teamSync) await teamSync.stop();
  server.close(() => process.exit(0));
  // Force exit after 2s if close hangs
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// tsx watch sends SIGUSR2 before restart — release port immediately
process.on('SIGUSR2', async () => {
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
  // Seed community lessons from framework seed file
  seedCommunityLessons();
  // Start TeamSyncService with graceful degradation
  const db = getDb();
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
});

export { app, server };
