import type { EconomyStatus } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class EconomyResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  get(): Promise<EconomyStatus> {
    return this.http.get<EconomyStatus>(`/api/projects/${this.projectId}/economy`);
  }

  toggle(): Promise<EconomyStatus> {
    return this.http.post<EconomyStatus>(`/api/projects/${this.projectId}/economy`, { toggle: true });
  }

  set(enabled: boolean): Promise<EconomyStatus> {
    return this.http.post<EconomyStatus>(`/api/projects/${this.projectId}/economy`, { enabled });
  }
}
