import type {
  Persona, PersonaHistoryEntry, PersonaSkill, PersonaStats,
  CreatePersonaInput, UpdatePersonaInput, CreatePersonaHistoryEntryInput,
} from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface PersonaHistoryFilters {
  entryType?: string;
}

export class PersonasResource {
  constructor(private http: HttpClient) {}

  list(): Promise<Persona[]> {
    return this.http.get<Persona[]>('/api/personas');
  }

  get(personaId: string): Promise<Persona> {
    return this.http.get<Persona>(`/api/personas/${personaId}`);
  }

  create(data: CreatePersonaInput): Promise<Persona> {
    return this.http.post<Persona>('/api/personas', data);
  }

  update(personaId: string, data: UpdatePersonaInput): Promise<Persona> {
    return this.http.patch<Persona>(`/api/personas/${personaId}`, data);
  }

  delete(personaId: string): Promise<void> {
    return this.http.delete<void>(`/api/personas/${personaId}`);
  }

  listHistory(personaId: string, filters?: PersonaHistoryFilters): Promise<PersonaHistoryEntry[]> {
    const params = new URLSearchParams();
    if (filters?.entryType) params.set('entryType', filters.entryType);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<PersonaHistoryEntry[]>(`/api/personas/${personaId}/history${qs}`);
  }

  addHistoryEntry(personaId: string, data: Omit<CreatePersonaHistoryEntryInput, 'personaId'>): Promise<PersonaHistoryEntry> {
    return this.http.post<PersonaHistoryEntry>(`/api/personas/${personaId}/history`, data);
  }

  listSkills(personaId: string): Promise<PersonaSkill[]> {
    return this.http.get<PersonaSkill[]>(`/api/personas/${personaId}/skills`);
  }

  addSkill(personaId: string, skillId: string): Promise<PersonaSkill> {
    return this.http.post<PersonaSkill>(`/api/personas/${personaId}/skills`, { skillId });
  }

  removeSkill(personaId: string, skillId: string): Promise<void> {
    return this.http.delete<void>(`/api/personas/${personaId}/skills/${skillId}`);
  }

  getStats(personaId: string): Promise<PersonaStats> {
    return this.http.get<PersonaStats>(`/api/personas/${personaId}/stats`);
  }

  updateStats(personaId: string, data: { projectCount?: number; cardCount?: number; qualityAvg?: number | null }): Promise<PersonaStats> {
    return this.http.patch<PersonaStats>(`/api/personas/${personaId}/stats`, data);
  }
}
