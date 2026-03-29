import type { JournalEntry, CreateJournalInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface JournalFilters {
  limit?: number;
  entryType?: string;
}

export class JournalResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: JournalFilters): Promise<JournalEntry[]> {
    const params = new URLSearchParams();
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.entryType) params.set('entryType', filters.entryType);
    const qs = params.toString() ? `?${params}` : '';
    return this.http.get<JournalEntry[]>(`/api/projects/${this.projectId}/journal${qs}`);
  }

  log(data: Omit<CreateJournalInput, 'projectId'>): Promise<JournalEntry> {
    return this.http.post<JournalEntry>('/api/journal', { ...data, projectId: this.projectId });
  }
}
