import type { Agent, SpawnAgentInput, UpdateAgentInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface AgentFilters {
  status?: string;
  type?: string;
  cardId?: string;
}

export class AgentsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: AgentFilters): Promise<Agent[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.cardId) params.set('cardId', filters.cardId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Agent[]>(`/api/projects/${this.projectId}/agents${qs}`);
  }

  spawn(data: Omit<SpawnAgentInput, 'projectId'>): Promise<Agent> {
    return this.http.post<Agent>(`/api/agents`, { ...data, projectId: this.projectId });
  }

  update(agentId: string, data: UpdateAgentInput): Promise<Agent> {
    return this.http.patch<Agent>(`/api/agents/${agentId}`, data);
  }
}
