import type { Epic, CreateEpicInput, UpdateEpicInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class EpicsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(): Promise<Epic[]> {
    return this.http.get<Epic[]>(`/api/projects/${this.projectId}/epics`);
  }

  create(data: CreateEpicInput): Promise<Epic> {
    return this.http.post<Epic>(`/api/projects/${this.projectId}/epics`, data);
  }

  update(epicId: string, data: UpdateEpicInput): Promise<Epic> {
    return this.http.patch<Epic>(`/api/epics/${epicId}`, data);
  }
}
