import { watch, type FSWatcher } from 'chokidar';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WATCHER_DEBOUNCE_MS, WATCHER_RETRY_MS } from '@vldr/shared';
import { TEAMS_DIR, TASKS_DIR } from '@vldr/shared/team-constants';

// Filesystem JSON shapes (imported types from diff-engine when available)
export interface FsTeamConfig {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: Array<{
    agentId: string;
    name: string;
    agentType: string;
    model: string;
    joinedAt: number;
    cwd?: string;
  }>;
}

export interface FsInboxMessage {
  from: string;
  text: string;
  summary?: string;
  timestamp: string;
  color?: string;
  read: boolean;
}

export interface FsTask {
  id: string;
  subject: string;
  description?: string;
  owner?: string;
  status: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export type FileChangeEvent =
  | { type: 'config'; teamName: string; content: FsTeamConfig | null }
  | { type: 'inbox'; teamName: string; agentName: string; content: FsInboxMessage[] }
  | { type: 'task'; teamName: string; taskId: string; content: FsTask };

type ChangeHandler = (event: FileChangeEvent) => void;

export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private handler: ChangeHandler | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  onchange(handler: ChangeHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    await mkdir(TEAMS_DIR, { recursive: true });

    // usePolling required inside Docker on Windows — bind mounts don't propagate inotify
    const usePolling = process.env.VLDR_WATCHER_POLLING === '1'
      || process.env.NODE_ENV === 'production';

    const teamsWatcher = watch(TEAMS_DIR, {
      ignoreInitial: false,
      depth: 3,
      usePolling,
      interval: usePolling ? 1000 : undefined,
      awaitWriteFinish: { stabilityThreshold: WATCHER_DEBOUNCE_MS, pollInterval: 50 },
    });

    teamsWatcher.on('add', (fp) => this.debounced(fp, () => this.handleFile(fp)));
    teamsWatcher.on('change', (fp) => this.debounced(fp, () => this.handleFile(fp)));
    teamsWatcher.on('unlink', (fp) => this.handleUnlink(fp));

    this.watchers.push(teamsWatcher);

    if (existsSync(TASKS_DIR)) {
      const tasksWatcher = watch(TASKS_DIR, {
        ignoreInitial: false,
        depth: 2,
        usePolling,
        interval: usePolling ? 1000 : undefined,
        awaitWriteFinish: { stabilityThreshold: WATCHER_DEBOUNCE_MS, pollInterval: 50 },
      });

      tasksWatcher.on('add', (fp) => this.debounced(fp, () => this.handleFile(fp)));
      tasksWatcher.on('change', (fp) => this.debounced(fp, () => this.handleFile(fp)));

      this.watchers.push(tasksWatcher);
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const w of this.watchers) await w.close();
    this.watchers = [];
  }

  private debounced(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, WATCHER_DEBOUNCE_MS));
  }

  private async handleFile(filePath: string): Promise<void> {
    if (!this.handler) return;

    const normalized = filePath.replace(/\\/g, '/');

    const teamsMatch = normalized.match(/teams\/([^/]+)\/config\.json$/);
    const inboxMatch = normalized.match(/teams\/([^/]+)\/inboxes\/([^/]+)\.json$/);
    const taskMatch = normalized.match(/tasks\/([^/]+)\/(\d+)\.json$/);

    if (!teamsMatch && !inboxMatch && !taskMatch) return;

    const content = await this.safeReadJson(filePath);
    if (content === undefined) return;

    if (teamsMatch) {
      this.handler({ type: 'config', teamName: teamsMatch[1], content: content as FsTeamConfig });
    } else if (inboxMatch) {
      this.handler({
        type: 'inbox',
        teamName: inboxMatch[1],
        agentName: inboxMatch[2],
        content: (content || []) as FsInboxMessage[],
      });
    } else if (taskMatch) {
      const teamName = taskMatch[1];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(teamName)) return;
      this.handler({
        type: 'task',
        teamName,
        taskId: taskMatch[2],
        content: content as FsTask,
      });
    }
  }

  private handleUnlink(filePath: string): void {
    if (!this.handler) return;
    const normalized = filePath.replace(/\\/g, '/');
    const teamsMatch = normalized.match(/teams\/([^/]+)\/config\.json$/);
    if (teamsMatch) {
      this.handler({ type: 'config', teamName: teamsMatch[1], content: null });
    }
  }

  private async safeReadJson(filePath: string): Promise<unknown | undefined> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      await new Promise(r => setTimeout(r, WATCHER_RETRY_MS));
      try {
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`[TeamWatcher] Failed to parse ${filePath}:`, (err as Error).message);
        return undefined;
      }
    }
  }
}
