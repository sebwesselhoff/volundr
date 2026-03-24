import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { CACHE_MAX_TEAMS } from '@vldr/shared';
import { TEAMS_DIR } from '@vldr/shared/team-constants';
import type { ServerMessage, Team, TeamMember, TeamMessage, TeamTask } from '@vldr/shared';
import { FileWatcher } from './file-watcher.js';
import {
  diffConfig,
  diffInbox,
  diffTask,
  contentHash,
} from './diff-engine.js';
import type {
  FsTeamConfig,
  FsInboxMessage,
  FsTask,
  TeamSnapshot,
  TeamDelta,
} from './diff-engine.js';
import * as schema from '@vldr/db/schema';
import type { Db } from '@vldr/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function teamIdFromConfig(teamName: string, createdAt: number): string {
  return createHash('sha256')
    .update(teamName + ':' + createdAt)
    .digest('hex')
    .slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function emptySnapshot(): TeamSnapshot {
  return { config: null, inboxHashes: new Map(), tasks: new Map() };
}

// ---------------------------------------------------------------------------
// TeamSyncService
// ---------------------------------------------------------------------------

export class TeamSyncService {
  private db: Db;
  private broadcast: (msg: ServerMessage) => void;
  private watcher: FileWatcher | null = null;

  /** teamName → TeamSnapshot */
  private cache = new Map<string, TeamSnapshot>();
  /** teamName → DB row id */
  private teamIdByName = new Map<string, string>();

  constructor(db: Db, broadcast: (msg: ServerMessage) => void) {
    this.db = db;
    this.broadcast = broadcast;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.reapStaleTeams();
    await this.hydrateCache();

    this.watcher = new FileWatcher();
    this.watcher.onchange((event) => {
      if (event.type === 'config') {
        this.handleConfig(event.teamName, event.content as FsTeamConfig | null);
      } else if (event.type === 'inbox') {
        this.handleInbox(event.teamName, event.agentName, event.content as FsInboxMessage[]);
      } else if (event.type === 'task') {
        this.handleTask(event.teamName, event.taskId, event.content as FsTask);
      }
    });
    await this.watcher.start();
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
  }

  // -------------------------------------------------------------------------
  // Startup helpers
  // -------------------------------------------------------------------------

  /** Mark DB-active teams as 'ended' if their config.json no longer exists. */
  private reapStaleTeams(): void {
    try {
      const activeTeams = this.db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.status, 'active'))
        .all();

      for (const team of activeTeams) {
        const configPath = path.join(TEAMS_DIR, team.name, 'config.json');
        if (!existsSync(configPath)) {
          const endedAt = nowIso();
          this.db
            .update(schema.teams)
            .set({ status: 'ended', endedAt })
            .where(eq(schema.teams.id, team.id))
            .run();
          console.log(`[TeamSync] Reaped stale team: ${team.name}`);
        }
      }
    } catch (err) {
      console.warn('[TeamSync] reapStaleTeams error:', (err as Error).message);
    }
  }

  /**
   * Walk filesystem and rebuild the in-memory cache from all existing
   * config.json files.  Populates teamIdByName so we know which DB ids to use.
   */
  private async hydrateCache(): Promise<void> {
    if (!existsSync(TEAMS_DIR)) return;

    let dirs: string[];
    try {
      dirs = readdirSync(TEAMS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return;
    }

    // Only keep the most-recent CACHE_MAX_TEAMS teams
    const limited = dirs.slice(0, CACHE_MAX_TEAMS);

    for (const teamName of limited) {
      const configPath = path.join(TEAMS_DIR, teamName, 'config.json');
      if (!existsSync(configPath)) continue;

      try {
        const raw = await readFile(configPath, 'utf-8');
        const config: FsTeamConfig = JSON.parse(raw);
        const teamId = teamIdFromConfig(teamName, config.createdAt);

        const snapshot = emptySnapshot();
        snapshot.config = config;
        this.cache.set(teamName, snapshot);
        this.teamIdByName.set(teamName, teamId);

        // Upsert team into DB so it's queryable immediately
        const row = {
          id: teamId,
          name: teamName,
          description: config.description ?? null,
          leadAgentId: config.leadAgentId,
          leadSessionId: config.leadSessionId ?? null,
          status: 'active' as const,
          createdAt: new Date(config.createdAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
          endedAt: null,
        };
        this.db.insert(schema.teams).values(row)
          .onConflictDoUpdate({
            target: schema.teams.name,
            set: { status: 'active', endedAt: null, leadAgentId: row.leadAgentId },
          }).run();

        // Upsert members
        for (const member of config.members) {
          const memberId = uuid();
          const joinedAt = new Date(member.joinedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
          // Check if member already exists
          const existing = this.db.select().from(schema.teamMembers)
            .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, member.agentId)))
            .get();
          if (!existing) {
            this.db.insert(schema.teamMembers).values({
              id: memberId, teamId, agentId: member.agentId, name: member.name,
              agentType: member.agentType, model: member.model, status: 'active',
              joinedAt, leftAt: null, cwd: member.cwd ?? null,
            }).run();
          }
        }

        // Build inbox hashes for existing messages so we don't re-emit them
        await this.hydrateInboxHashes(teamName, teamId, snapshot);
      } catch (err) {
        console.warn(`[TeamSync] Failed to hydrate team ${teamName}:`, (err as Error).message);
      }
    }
  }

  private async hydrateInboxHashes(
    teamName: string,
    teamId: string,
    snapshot: TeamSnapshot,
  ): Promise<void> {
    const inboxDir = path.join(TEAMS_DIR, teamName, 'inboxes');
    if (!existsSync(inboxDir)) return;

    let files: string[];
    try {
      files = readdirSync(inboxDir).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const agentName = file.replace(/\.json$/, '');
      const filePath = path.join(inboxDir, file);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const messages: FsInboxMessage[] = JSON.parse(raw);
        const hashes = new Set<string>(messages.map(m => contentHash(teamId, m)));
        snapshot.inboxHashes.set(agentName, hashes);
      } catch {
        // tolerate
      }
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers (called by FileWatcher)
  // -------------------------------------------------------------------------

  handleConfig(teamName: string, newConfig: FsTeamConfig | null): void {
    const snapshot = this.cache.get(teamName) ?? emptySnapshot();
    const oldConfig = snapshot.config;

    const deltas = diffConfig(oldConfig, newConfig);
    if (deltas.length === 0) return;

    for (const delta of deltas) {
      this.applyDelta(teamName, snapshot, delta);
    }

    snapshot.config = newConfig;
    this.cache.set(teamName, snapshot);

    // Evict oldest if over limit
    if (this.cache.size > CACHE_MAX_TEAMS) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  handleInbox(teamName: string, agentName: string, messages: FsInboxMessage[]): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return; // team not yet registered

    const snapshot = this.cache.get(teamName);
    if (!snapshot) return;

    if (!snapshot.inboxHashes.has(agentName)) {
      snapshot.inboxHashes.set(agentName, new Set());
    }
    const knownHashes = snapshot.inboxHashes.get(agentName)!;

    const deltas = diffInbox(teamId, agentName, knownHashes, messages);
    for (const delta of deltas) {
      this.applyDelta(teamName, snapshot, delta);
    }
  }

  handleTask(teamName: string, _taskId: string, task: FsTask): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const snapshot = this.cache.get(teamName);
    if (!snapshot) return;

    const oldTask = snapshot.tasks.get(task.id) ?? null;
    const deltas = diffTask(oldTask, task);
    for (const delta of deltas) {
      this.applyDelta(teamName, snapshot, delta);
    }
    snapshot.tasks.set(task.id, task);
  }

  // -------------------------------------------------------------------------
  // Delta → DB + broadcast
  // -------------------------------------------------------------------------

  private applyDelta(teamName: string, snapshot: TeamSnapshot, delta: TeamDelta): void {
    try {
      switch (delta.type) {
        case 'team_created':
          this.onTeamCreated(teamName, snapshot, delta.config);
          break;
        case 'team_ended':
          this.onTeamEnded(teamName);
          break;
        case 'member_joined':
          this.onMemberJoined(teamName, delta.member);
          break;
        case 'member_left':
          this.onMemberLeft(teamName, delta.agentId);
          break;
        case 'member_updated':
          this.onMemberUpdated(teamName, delta.agentId, delta.changes);
          break;
        case 'member_status':
          this.onMemberStatus(teamName, delta.agentId, delta.status);
          break;
        case 'message_new':
          this.onMessageNew(teamName, snapshot, delta.agentName, delta.message, delta.contentHash);
          break;
        case 'task_created':
          this.onTaskCreated(teamName, delta.task);
          break;
        case 'task_updated':
          this.onTaskUpdated(teamName, delta.task);
          break;
      }
    } catch (err) {
      console.warn(`[TeamSync] applyDelta ${delta.type} error:`, (err as Error).message);
    }
  }

  // -------------------------------------------------------------------------
  // Individual delta handlers
  // -------------------------------------------------------------------------

  private onTeamCreated(teamName: string, snapshot: TeamSnapshot, config: FsTeamConfig): void {
    const teamId = teamIdFromConfig(teamName, config.createdAt);
    this.teamIdByName.set(teamName, teamId);

    const row = {
      id: teamId,
      name: teamName,
      description: config.description ?? null,
      leadAgentId: config.leadAgentId,
      leadSessionId: config.leadSessionId ?? null,
      status: 'active' as const,
      createdAt: new Date(config.createdAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
      endedAt: null,
    };

    this.db
      .insert(schema.teams)
      .values(row)
      .onConflictDoUpdate({
        target: schema.teams.name,
        set: {
          leadAgentId: row.leadAgentId,
          leadSessionId: row.leadSessionId,
          description: row.description,
          status: 'active',
          endedAt: null,
        },
      })
      .run();

    const dbRow = this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();

    if (dbRow) {
      this.broadcast({ type: 'team:created', data: this.mapTeam(dbRow) });
    }
  }

  private onTeamEnded(teamName: string): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const endedAt = nowIso();
    this.db
      .update(schema.teams)
      .set({ status: 'ended', endedAt })
      .where(eq(schema.teams.id, teamId))
      .run();

    this.broadcast({ type: 'team:ended', data: { teamId, endedAt } });
  }

  private onMemberJoined(teamName: string, member: import('./diff-engine.js').FsTeamMember): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const memberId = uuid();
    const joinedAt = new Date(member.joinedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    const row = {
      id: memberId,
      teamId,
      agentId: member.agentId,
      name: member.name,
      agentType: member.agentType,
      model: member.model,
      status: 'active' as const,
      joinedAt,
      leftAt: null,
      cwd: member.cwd ?? null,
    };

    this.db.insert(schema.teamMembers).values(row).run();

    this.broadcast({ type: 'team:member_joined', data: this.mapMember(row) });
  }

  private onMemberLeft(teamName: string, agentId: string): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const leftAt = nowIso();
    const existing = this.db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agentId)))
      .get();

    if (!existing) return;

    this.db
      .update(schema.teamMembers)
      .set({ status: 'left', leftAt })
      .where(eq(schema.teamMembers.id, existing.id))
      .run();

    const updated = this.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, existing.id))
      .get();

    if (updated) {
      this.broadcast({ type: 'team:member_left', data: this.mapMember(updated) });
    }
  }

  private onMemberUpdated(
    teamName: string,
    agentId: string,
    changes: Partial<import('./diff-engine.js').FsTeamMember>,
  ): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const existing = this.db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agentId)))
      .get();

    if (!existing) return;

    const updates: Record<string, unknown> = {};
    if (changes.name != null) updates.name = changes.name;
    if (changes.model != null) updates.model = changes.model;
    if (changes.cwd !== undefined) updates.cwd = changes.cwd ?? null;

    if (Object.keys(updates).length === 0) return;

    this.db
      .update(schema.teamMembers)
      .set(updates)
      .where(eq(schema.teamMembers.id, existing.id))
      .run();

    this.broadcast({
      type: 'team:member_updated',
      data: { id: existing.id, ...updates } as Partial<TeamMember> & { id: string },
    });
  }

  private onMemberStatus(teamName: string, agentId: string, status: import('@vldr/shared').TeamMemberStatus): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const existing = this.db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agentId)))
      .get();

    if (!existing) return;

    this.db
      .update(schema.teamMembers)
      .set({ status })
      .where(eq(schema.teamMembers.id, existing.id))
      .run();

    this.broadcast({
      type: 'team:member_updated',
      data: { id: existing.id, status },
    });
  }

  private onMessageNew(
    teamName: string,
    snapshot: TeamSnapshot,
    agentName: string,
    message: FsInboxMessage,
    hash: string,
  ): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const row = {
      teamId,
      fromAgent: message.from,
      toAgent: agentName !== message.from ? agentName : null,
      text: message.text,
      summary: message.summary ?? null,
      timestamp: message.timestamp,
      read: message.read,
      contentHash: hash,
    };

    this.db
      .insert(schema.teamMessages)
      .values(row)
      .onConflictDoNothing()
      .run();

    // Mark hash as known
    let hashes = snapshot.inboxHashes.get(agentName);
    if (!hashes) {
      hashes = new Set();
      snapshot.inboxHashes.set(agentName, hashes);
    }
    hashes.add(hash);

    // Fetch the inserted row to get the auto-increment id
    const inserted = this.db
      .select()
      .from(schema.teamMessages)
      .where(and(eq(schema.teamMessages.teamId, teamId), eq(schema.teamMessages.contentHash, hash)))
      .get();

    if (inserted) {
      this.broadcast({ type: 'team:message', data: this.mapMessage(inserted) });
    }
  }

  private onTaskCreated(teamName: string, task: FsTask): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const row = {
      teamId,
      taskId: task.id,
      subject: task.subject,
      description: task.description ?? null,
      status: task.status,
      owner: task.owner ?? null,
      blocks: task.blocks ? JSON.stringify(task.blocks) : null,
      blockedBy: task.blockedBy ? JSON.stringify(task.blockedBy) : null,
      claimedAt: null,
      completedAt: null,
    };

    this.db
      .insert(schema.teamTasks)
      .values(row)
      .onConflictDoNothing()
      .run();

    const inserted = this.db
      .select()
      .from(schema.teamTasks)
      .where(and(eq(schema.teamTasks.teamId, teamId), eq(schema.teamTasks.taskId, task.id)))
      .get();

    if (inserted) {
      this.broadcast({ type: 'team:task_created', data: this.mapTask(inserted) });
    }
  }

  private onTaskUpdated(teamName: string, task: FsTask): void {
    const teamId = this.teamIdByName.get(teamName);
    if (!teamId) return;

    const existing = this.db
      .select()
      .from(schema.teamTasks)
      .where(and(eq(schema.teamTasks.teamId, teamId), eq(schema.teamTasks.taskId, task.id)))
      .get();

    if (!existing) {
      // Fall back to create if somehow we missed the creation event
      this.onTaskCreated(teamName, task);
      return;
    }

    const updates: Record<string, unknown> = {
      status: task.status,
      subject: task.subject,
      owner: task.owner ?? null,
      blocks: task.blocks ? JSON.stringify(task.blocks) : null,
      blockedBy: task.blockedBy ? JSON.stringify(task.blockedBy) : null,
    };

    if (task.status === 'in_progress' && !existing.claimedAt) {
      updates.claimedAt = nowIso();
    }
    if (task.status === 'done' && !existing.completedAt) {
      updates.completedAt = nowIso();
    }

    this.db
      .update(schema.teamTasks)
      .set(updates)
      .where(eq(schema.teamTasks.id, existing.id))
      .run();

    this.broadcast({
      type: 'team:task_updated',
      data: { id: existing.id, ...updates } as unknown as Partial<TeamTask> & { id: number },
    });
  }

  // -------------------------------------------------------------------------
  // DB row → shared type mappers
  // -------------------------------------------------------------------------

  private mapTeam(row: typeof schema.teams.$inferSelect): Team {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      leadAgentId: row.leadAgentId,
      leadSessionId: row.leadSessionId ?? null,
      status: row.status as Team['status'],
      createdAt: row.createdAt,
      endedAt: row.endedAt ?? null,
    };
  }

  private mapMember(row: typeof schema.teamMembers.$inferSelect): TeamMember {
    return {
      id: row.id,
      teamId: row.teamId,
      agentId: row.agentId,
      name: row.name,
      agentType: row.agentType,
      model: row.model,
      status: row.status as TeamMember['status'],
      joinedAt: row.joinedAt,
      leftAt: row.leftAt ?? null,
      cwd: row.cwd ?? null,
    };
  }

  private mapMessage(row: typeof schema.teamMessages.$inferSelect): TeamMessage {
    return {
      id: row.id,
      teamId: row.teamId,
      fromAgent: row.fromAgent,
      toAgent: row.toAgent ?? null,
      text: row.text,
      summary: row.summary ?? null,
      timestamp: row.timestamp,
      read: Boolean(row.read),
    };
  }

  private mapTask(row: typeof schema.teamTasks.$inferSelect): TeamTask {
    let blocks: string[] = [];
    let blockedBy: string[] = [];
    try { blocks = row.blocks ? JSON.parse(row.blocks) : []; } catch { /* noop */ }
    try { blockedBy = row.blockedBy ? JSON.parse(row.blockedBy) : []; } catch { /* noop */ }

    return {
      id: row.id,
      teamId: row.teamId,
      taskId: row.taskId,
      subject: row.subject,
      description: row.description ?? null,
      status: row.status as TeamTask['status'],
      owner: row.owner ?? null,
      blocks,
      blockedBy,
      claimedAt: row.claimedAt ?? null,
      completedAt: row.completedAt ?? null,
    };
  }
}
