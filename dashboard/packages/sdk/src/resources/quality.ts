import type { QualityScore, ScoreQualityInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class QualityResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(): Promise<QualityScore[]> {
    return this.http.get<QualityScore[]>(`/api/projects/${this.projectId}/quality`);
  }

  score(data: ScoreQualityInput): Promise<QualityScore> {
    return this.http.post<QualityScore>(`/api/quality`, data);
  }
}
