import type {
  Agent, Card, Epic, Event, Project, MetricsResponse, LogEntry,
  JournalEntry, SessionSummary, Team, TeamMember, TeamMessage, TeamTask,
  Persona, PersonaHistoryEntry,
} from './types.js';

// Server → All Clients
export type ServerMessage =
  | { type: 'agent:started'; data: Agent }
  | { type: 'agent:updated'; data: Partial<Agent> & { id: string } }
  | { type: 'card:updated'; data: Card }
  | { type: 'event:new'; data: Event }
  | { type: 'metrics:updated'; data: MetricsResponse }
  | { type: 'project:updated'; data: Partial<Project> & { id: string } }
  | { type: 'epic:created'; data: Epic }
  | { type: 'epic:updated'; data: Epic }
  | { type: 'command:pending'; data: { commandId: string; commandType: string; target: string } }
  | { type: 'command:acknowledged'; data: { commandId: string } }
  | { type: 'command:failed'; data: { commandId: string; reason: string } }
  | { type: 'log:entry'; data: LogEntry }
  | { type: 'journal:new'; data: JournalEntry }
  | { type: 'session_summary:new'; data: SessionSummary }
  // Agent Teams
  | { type: 'team:created'; data: Team }
  | { type: 'team:ended'; data: { teamId: string; endedAt: string } }
  | { type: 'team:member_joined'; data: TeamMember }
  | { type: 'team:member_updated'; data: Partial<TeamMember> & { id: string } }
  | { type: 'team:member_left'; data: TeamMember }
  | { type: 'team:message'; data: TeamMessage }
  | { type: 'team:task_created'; data: TeamTask }
  | { type: 'team:task_updated'; data: Partial<TeamTask> & { id: number } }
  // Personas
  | { type: 'persona:created'; data: Persona }
  | { type: 'persona:updated'; data: Persona }
  | { type: 'persona:history_entry'; data: PersonaHistoryEntry }
  // Packs
  | { type: 'pack:installed'; data: { pack: string; version: string; personasRegistered: string[]; personasSkipped: string[]; agentTypesActivated: string[] } };

// Browser → Server (Dashboard Commands)
export type DashboardCommand =
  | { type: 'command:pause'; projectId: string }
  | { type: 'command:resume'; projectId: string }
  | { type: 'command:skip'; cardId: string; reason?: string }
  | { type: 'command:retry'; cardId: string }
  | { type: 'command:reprioritize'; cardId: string; priority: string }
  | { type: 'command:set-gate'; projectId: string; level: number }
  | { type: 'command:spawn-teammate'; projectId: string; role: string; domain?: string; model?: string }
  | { type: 'command:shutdown-teammate'; projectId: string; agentId: string }
  | { type: 'command:promote-to-teammate'; projectId: string; agentId: string }
  | { type: 'command:scale-down'; projectId: string; maxTeammates: number }
  | { type: 'command:reassign-card'; cardId: string; fromAgentId: string; toAgentId: string };

// Vǫlundr → Server
export type VldrMessage =
  | { type: 'vldr:heartbeat'; status: string; activeCard?: string; activeAgents: number }
  | { type: 'vldr:ack'; commandId: string; success: boolean; detail?: string };

// Client registration (sent on WS connect)
export type ClientRegister =
  | { type: 'register'; role: 'browser' }
  | { type: 'register'; role: 'volundr'; projectId: string };

export type IncomingWsMessage = DashboardCommand | VldrMessage | ClientRegister;
