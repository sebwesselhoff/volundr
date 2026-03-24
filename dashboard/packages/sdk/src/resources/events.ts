import type { Event, LogEventInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface EventFilters {
  type?: string;
  cardId?: string;
  limit?: number;
  offset?: number;
}

export class EventsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: EventFilters): Promise<Event[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.set('type', filters.type);
    if (filters?.cardId) params.set('cardId', filters.cardId);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Event[]>(`/api/projects/${this.projectId}/events${qs}`);
  }

  log(data: Omit<LogEventInput, 'projectId'>): Promise<Event> {
    return this.http.post<Event>(`/api/events`, { ...data, projectId: this.projectId });
  }
}
