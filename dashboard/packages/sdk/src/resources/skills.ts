import type { Skill, CreateSkillInput, UpdateSkillInput, SkillMatchResult } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface SkillFilters {
  domain?: string;
  q?: string;
}

export interface SkillMatchInput {
  query: string;
  domain?: string;
  roles?: string[];
  limit?: number;
}

export class SkillsResource {
  constructor(private http: HttpClient) {}

  list(filters?: SkillFilters): Promise<Skill[]> {
    const params = new URLSearchParams();
    if (filters?.domain) params.set('domain', filters.domain);
    if (filters?.q) params.set('q', filters.q);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Skill[]>(`/api/skills${qs}`);
  }

  get(id: string): Promise<Skill> {
    return this.http.get<Skill>(`/api/skills/${id}`);
  }

  create(data: CreateSkillInput): Promise<Skill> {
    return this.http.post<Skill>('/api/skills', data);
  }

  update(id: string, data: UpdateSkillInput): Promise<Skill> {
    return this.http.patch<Skill>(`/api/skills/${id}`, data);
  }

  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/api/skills/${id}`);
  }

  match(input: SkillMatchInput): Promise<SkillMatchResult[]> {
    return this.http.post<SkillMatchResult[]>('/api/skills/match', input);
  }
}
