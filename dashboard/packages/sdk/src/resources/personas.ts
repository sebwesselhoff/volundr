import type {
  Persona, PersonaHistoryEntry,
  CreatePersonaInput, UpdatePersonaInput, CreatePersonaHistoryEntryInput,
} from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface PersonaFilters {
  status?: string;
}

export interface PersonaHistoryFilters {
  section?: string;
}

export class PersonasResource {
  constructor(private http: HttpClient) {}

  list(filters?: PersonaFilters): Promise<Persona[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Persona[]>(`/api/personas${qs}`);
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
    if (filters?.section) params.set('section', filters.section);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<PersonaHistoryEntry[]>(`/api/personas/${personaId}/history${qs}`);
  }

  addHistoryEntry(personaId: string, data: CreatePersonaHistoryEntryInput): Promise<PersonaHistoryEntry> {
    return this.http.post<PersonaHistoryEntry>(`/api/personas/${personaId}/history`, data);
  }
}
