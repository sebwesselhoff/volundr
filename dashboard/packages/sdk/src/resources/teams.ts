import type { Team, TeamWithMembers, TeamMessage, TeamTask } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface TeamFilters {
  status?: string;
}

export interface TeamMessageFilters {
  agent?: string;
  limit?: number;
  before?: number;
}

export class TeamsResource {
  constructor(private http: HttpClient) {}

  list(filters?: TeamFilters): Promise<Team[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params}` : '';
    return this.http.get<Team[]>(`/api/teams${qs}`);
  }

  get(teamId: string): Promise<TeamWithMembers> {
    return this.http.get<TeamWithMembers>(`/api/teams/${teamId}`);
  }

  messages(teamId: string, filters?: TeamMessageFilters): Promise<TeamMessage[]> {
    const params = new URLSearchParams();
    if (filters?.agent) params.set('agent', filters.agent);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.before) params.set('before', String(filters.before));
    const qs = params.toString() ? `?${params}` : '';
    return this.http.get<TeamMessage[]>(`/api/teams/${teamId}/messages${qs}`);
  }

  tasks(teamId: string): Promise<TeamTask[]> {
    return this.http.get<TeamTask[]>(`/api/teams/${teamId}/tasks`);
  }
}
