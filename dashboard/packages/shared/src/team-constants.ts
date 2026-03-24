import path from 'node:path';
import os from 'node:os';

export const CLAUDE_HOME = process.env.CLAUDE_HOME
  || path.join(os.homedir(), '.claude');

export const TEAMS_DIR = path.join(CLAUDE_HOME, 'teams');
export const TASKS_DIR = path.join(CLAUDE_HOME, 'tasks');

export const TEAM_STATUS_SIGNALS = {
  idle: ['idle_notification', 'idle_ping'] as readonly string[],
  stopped: ['shutdown_request', 'shutdown', 'shutdown_approved'] as readonly string[],
} as const;

export const WATCHER_DEBOUNCE_MS = Number(process.env.VLDR_WATCHER_DEBOUNCE_MS) || 200;
export const WATCHER_RETRY_MS = 100;
export const CACHE_MAX_TEAMS = 50;
