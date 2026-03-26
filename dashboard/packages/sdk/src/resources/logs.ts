import type { LogEntry, CreateLogInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface LogFilters {
  level?: string;
  source?: string;
  limit?: number;
}

export class LogsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: LogFilters): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (filters?.level) params.set('level', filters.level);
    if (filters?.source) params.set('source', filters.source);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const qs = params.toString() ? `?${params}` : '';
    return this.http.get<LogEntry[]>(`/api/projects/${this.projectId}/logs${qs}`);
  }

  create(data: CreateLogInput): Promise<LogEntry> {
    return this.http.post<LogEntry>('/api/logs', { ...data, projectId: this.projectId });
  }
}
