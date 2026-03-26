import { API_PORT, HEALTH_CHECK_RETRY_DELAY, HEALTH_CHECK_MAX_RETRIES } from '@vldr/shared';
import type { ServerMessage, HealthResponse } from '@vldr/shared';
import { HttpClient } from './http.js';
import { WsClient } from './ws.js';
import { ProjectsResource } from './resources/projects.js';
import { EpicsResource } from './resources/epics.js';
import { CardsResource } from './resources/cards.js';
import { AgentsResource } from './resources/agents.js';
import { EventsResource } from './resources/events.js';
import { QualityResource } from './resources/quality.js';
import { MetricsResource } from './resources/metrics.js';
import { LessonsResource } from './resources/lessons.js';
import { PersonasResource } from './resources/personas.js';
import { SkillsResource } from './resources/skills.js';

export type { CardFilters } from './resources/cards.js';
export type { AgentFilters } from './resources/agents.js';
export type { EventFilters } from './resources/events.js';
export type { LessonFilters } from './resources/lessons.js';
export type { PersonaFilters, PersonaHistoryFilters } from './resources/personas.js';
export type { SkillFilters, SkillMatchInput } from './resources/skills.js';
export type { TimeRange } from './resources/metrics.js';
export type { HeartbeatState } from './ws.js';

export { HttpClient } from './http.js';
export { WsClient } from './ws.js';
export { ProjectsResource } from './resources/projects.js';
export { EpicsResource } from './resources/epics.js';
export { CardsResource } from './resources/cards.js';
export { AgentsResource } from './resources/agents.js';
export { EventsResource } from './resources/events.js';
export { QualityResource } from './resources/quality.js';
export { MetricsResource } from './resources/metrics.js';
export { LessonsResource } from './resources/lessons.js';
export { PersonasResource } from './resources/personas.js';
export { SkillsResource } from './resources/skills.js';

export interface VolundrClientConfig {
  apiUrl?: string;
  projectId: string;
}

export class VolundrClient {
  private http: HttpClient;
  private ws: WsClient;
  private commandHandlers: Array<(msg: ServerMessage) => void> = [];

  public readonly project: ProjectsResource;
  public readonly epics: EpicsResource;
  public readonly cards: CardsResource;
  public readonly agents: AgentsResource;
  public readonly events: EventsResource;
  public readonly quality: QualityResource;
  public readonly metrics: MetricsResource;
  public readonly lessons: LessonsResource;
  public readonly personas: PersonasResource;
  public readonly skills: SkillsResource;

  constructor(config: VolundrClientConfig) {
    const apiUrl = config.apiUrl ?? `http://localhost:${API_PORT}`;
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';

    this.http = new HttpClient(apiUrl);
    this.ws = new WsClient(wsUrl, config.projectId);

    this.project = new ProjectsResource(this.http, config.projectId);
    this.epics = new EpicsResource(this.http, config.projectId);
    this.cards = new CardsResource(this.http, config.projectId);
    this.agents = new AgentsResource(this.http, config.projectId);
    this.events = new EventsResource(this.http, config.projectId);
    this.quality = new QualityResource(this.http, config.projectId);
    this.metrics = new MetricsResource(this.http, config.projectId);
    this.lessons = new LessonsResource(this.http, config.projectId);
    this.personas = new PersonasResource(this.http);
    this.skills = new SkillsResource(this.http);

    // Forward commands to registered handlers
    this.ws.on('command', (msg: ServerMessage) => {
      for (const handler of this.commandHandlers) {
        handler(msg);
      }
    });

    // Flush offline queue on reconnect
    this.ws.on('connected', () => {
      if (this.http.queueSize > 0) {
        this.http.flush().catch(() => {
          // flush errors are surfaced per-request via the promise rejections
        });
      }
    });

    // Forward queue overflow warnings
    this.http.on('queue:overflow', (dropped: unknown) => {
      console.warn('[mc/sdk] HTTP queue overflow — oldest request dropped', dropped);
    });
  }

  async connect(): Promise<void> {
    // Health check with exponential-ish retry
    let lastError: unknown;
    for (let attempt = 0; attempt < HEALTH_CHECK_MAX_RETRIES; attempt++) {
      try {
        const health = await this.http.get<HealthResponse>('/api/health');
        if (health.status === 'ok') break;
        throw new Error(`API server reports status: ${health.status}`);
      } catch (err) {
        lastError = err;
        if (attempt < HEALTH_CHECK_MAX_RETRIES - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_CHECK_RETRY_DELAY));
        }
      }
    }

    if (lastError !== undefined && !this.http.isConnected) {
      // All retries exhausted — still attempt WS connection (will auto-reconnect)
      console.warn('[mc/sdk] API health check failed after retries; connecting WS anyway');
    }

    this.ws.connect();
  }

  onCommand(handler: (msg: ServerMessage) => void): void {
    this.commandHandlers.push(handler);
  }

  ack(commandId: string, success: boolean, detail?: string): void {
    this.ws.sendAck(commandId, success, detail);
  }

  updateHeartbeat(status: string, activeCard?: string, activeAgents?: number): void {
    this.ws.updateHeartbeat(status, activeCard, activeAgents);
  }

  disconnect(): void {
    this.ws.disconnect();
  }

  get isConnected(): boolean {
    return this.ws.isConnected;
  }
}
