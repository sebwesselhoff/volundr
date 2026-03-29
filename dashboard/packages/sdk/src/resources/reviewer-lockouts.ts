import type { ReviewerLockout } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface LockoutCheckResult {
  cardId: string;
  personaId: string;
  locked: boolean;
  lockout: ReviewerLockout | null;
}

export class ReviewerLockoutsResource {
  constructor(private http: HttpClient) {}

  list(): Promise<ReviewerLockout[]> {
    return this.http.get<ReviewerLockout[]>('/api/reviewer-lockouts');
  }

  forCard(cardId: string): Promise<ReviewerLockout[]> {
    return this.http.get<ReviewerLockout[]>(`/api/reviewer-lockouts/${cardId}`);
  }

  create(cardId: string, personaId: string, reason?: string): Promise<ReviewerLockout> {
    return this.http.post<ReviewerLockout>('/api/reviewer-lockouts', { cardId, personaId, reason });
  }

  remove(cardId: string, personaId: string): Promise<void> {
    return this.http.delete<void>(`/api/reviewer-lockouts/${cardId}/${personaId}`);
  }

  check(cardId: string, personaId: string): Promise<LockoutCheckResult> {
    return this.http.post<LockoutCheckResult>('/api/reviewer-lockouts/check', { cardId, personaId });
  }
}
