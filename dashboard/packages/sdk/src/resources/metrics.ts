import type { MetricsResponse } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface TimeRange {
  from?: string;
  to?: string;
}

export class MetricsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  get(timeRange?: TimeRange): Promise<MetricsResponse> {
    const params = new URLSearchParams();
    if (timeRange?.from) params.set('from', timeRange.from);
    if (timeRange?.to) params.set('to', timeRange.to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<MetricsResponse>(`/api/projects/${this.projectId}/metrics${qs}`);
  }
}
