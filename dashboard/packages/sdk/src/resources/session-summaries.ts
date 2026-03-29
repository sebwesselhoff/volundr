import type { SessionSummary, CreateSessionSummaryInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class SessionSummariesResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(limit?: number): Promise<SessionSummary[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.http.get<SessionSummary[]>(`/api/projects/${this.projectId}/session-summaries${qs}`);
  }

  create(data: Omit<CreateSessionSummaryInput, 'projectId'>): Promise<SessionSummary> {
    return this.http.post<SessionSummary>('/api/session-summaries', { ...data, projectId: this.projectId });
  }
}
