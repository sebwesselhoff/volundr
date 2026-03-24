import type { Card, CreateCardInput, UpdateCardInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface CardFilters {
  epicId?: string;
  status?: string;
}

export class CardsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: CardFilters): Promise<Card[]> {
    const params = new URLSearchParams();
    if (filters?.epicId) params.set('epicId', filters.epicId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Card[]>(`/api/projects/${this.projectId}/cards${qs}`);
  }

  create(data: CreateCardInput): Promise<Card> {
    return this.http.post<Card>(`/api/projects/${this.projectId}/cards`, data);
  }

  update(cardId: string, data: UpdateCardInput): Promise<Card> {
    return this.http.patch<Card>(`/api/cards/${cardId}`, data);
  }

  delete(cardId: string): Promise<void> {
    return this.http.delete<void>(`/api/cards/${cardId}`);
  }
}
