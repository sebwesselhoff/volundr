import { createHash } from 'node:crypto';
import { parseStatusSignal } from './status-resolver.js';
import type { TeamMemberStatus } from '@vldr/shared';

// --- Filesystem JSON shapes (what Agent Teams writes) ---

export interface FsTeamConfig {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: FsTeamMember[];
}

export interface FsTeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  joinedAt: number;
  cwd?: string;
  tmuxPaneId?: string;
  subscriptions?: string[];
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
  activeForm?: string;
  owner?: string;
  status: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

// --- Cached state shape ---

export interface TeamSnapshot {
  config: FsTeamConfig | null;
  inboxHashes: Map<string, Set<string>>;
  tasks: Map<string, FsTask>;
}

// --- Delta types ---

export type TeamDelta =
  | { type: 'team_created'; config: FsTeamConfig }
  | { type: 'team_ended'; teamName: string }
  | { type: 'member_joined'; member: FsTeamMember }
  | { type: 'member_left'; agentId: string }
  | { type: 'member_updated'; agentId: string; changes: Partial<FsTeamMember> }
  | { type: 'member_status'; agentId: string; status: TeamMemberStatus }
  | { type: 'message_new'; agentName: string; message: FsInboxMessage; contentHash: string }
  | { type: 'task_created'; task: FsTask }
  | { type: 'task_updated'; taskId: string; task: FsTask };

export function contentHash(teamId: string, msg: FsInboxMessage): string {
  const input = `${teamId}:${msg.from}:${msg.timestamp}:${(msg.text || '').slice(0, 64)}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function diffConfig(
  oldConfig: FsTeamConfig | null,
  newConfig: FsTeamConfig | null,
): TeamDelta[] {
  const deltas: TeamDelta[] = [];

  if (!oldConfig && newConfig) {
    deltas.push({ type: 'team_created', config: newConfig });
    for (const member of newConfig.members) {
      deltas.push({ type: 'member_joined', member });
    }
    return deltas;
  }

  if (oldConfig && !newConfig) {
    deltas.push({ type: 'team_ended', teamName: oldConfig.name });
    return deltas;
  }

  if (!oldConfig || !newConfig) return deltas;

  const oldMembers = new Map(oldConfig.members.map(m => [m.agentId, m]));
  const newMembers = new Map(newConfig.members.map(m => [m.agentId, m]));

  for (const [agentId, member] of newMembers) {
    if (!oldMembers.has(agentId)) {
      deltas.push({ type: 'member_joined', member });
    } else {
      const old = oldMembers.get(agentId)!;
      const changes: Partial<FsTeamMember> = {};
      if (old.name !== member.name) changes.name = member.name;
      if (old.model !== member.model) changes.model = member.model;
      if (old.cwd !== member.cwd) changes.cwd = member.cwd;
      if (Object.keys(changes).length > 0) {
        deltas.push({ type: 'member_updated', agentId, changes });
      }
    }
  }

  for (const agentId of oldMembers.keys()) {
    if (!newMembers.has(agentId)) {
      deltas.push({ type: 'member_left', agentId });
    }
  }

  return deltas;
}

export function diffInbox(
  teamId: string,
  agentName: string,
  knownHashes: Set<string>,
  messages: FsInboxMessage[],
): TeamDelta[] {
  const deltas: TeamDelta[] = [];

  for (const msg of messages) {
    const hash = contentHash(teamId, msg);
    if (!knownHashes.has(hash)) {
      deltas.push({ type: 'message_new', agentName, message: msg, contentHash: hash });
      const status = parseStatusSignal(msg.text);
      if (status) {
        deltas.push({ type: 'member_status', agentId: agentName, status });
      }
    }
  }

  return deltas;
}

export function diffTask(
  oldTask: FsTask | null,
  newTask: FsTask,
): TeamDelta[] {
  if (!oldTask) {
    return [{ type: 'task_created', task: newTask }];
  }
  if (
    oldTask.status !== newTask.status ||
    oldTask.owner !== newTask.owner ||
    oldTask.subject !== newTask.subject ||
    JSON.stringify(oldTask.blocks) !== JSON.stringify(newTask.blocks) ||
    JSON.stringify(oldTask.blockedBy) !== JSON.stringify(newTask.blockedBy)
  ) {
    return [{ type: 'task_updated', taskId: newTask.id, task: newTask }];
  }
  return [];
}
