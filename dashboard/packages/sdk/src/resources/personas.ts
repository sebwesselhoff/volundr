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

export interface CompileCharterInput {
  charterMd?: string;
  constraintsMd?: string;
  cardContext?: string;
  traits?: string[];
  cardStackTags?: string[];
  projectId?: string;
}

export interface CompileCharterResult {
  personaId: string;
  compiled: string;
  layerStats: { historyEntries: number; skills: number; directives: number };
}

export interface ExtractSkillsInput {
  confidenceThreshold?: number;
  limit?: number;
  dryRun?: boolean;
}

export interface ExtractSkillsResult {
  personaId?: string;
  dryRun?: boolean;
  created?: string[];
  updated?: string[];
  skills?: unknown[];
  includedEntryCount: number;
  totalSkillsProcessed?: number;
}

export interface DiscoverPersonasInput {
  stackSignals: string[];
  limit?: number;
  roleFilter?: string;
}

export interface PersonaDiscoveryResult {
  personaId: string;
  name: string;
  role: string;
  score: number;
  matchedSignals: string[];
  reason: string;
}

export interface DiscoverPersonasResult {
  stackSignals: string[];
  results: PersonaDiscoveryResult[];
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

  /**
   * Compile the persona's system prompt for injection at spawn time.
   * Runs the 8-layer charter compiler and returns the assembled string.
   */
  compile(personaId: string, input?: CompileCharterInput): Promise<CompileCharterResult> {
    return this.http.post<CompileCharterResult>(`/api/personas/${personaId}/compile`, input ?? {});
  }

  /**
   * Discover relevant persona seeds for a given tech stack.
   * Returns ranked persona recommendations — no DB records are created.
   */
  discover(input: DiscoverPersonasInput): Promise<DiscoverPersonasResult> {
    return this.http.post<DiscoverPersonasResult>('/api/personas/discover', input);
  }

  /**
   * Run the history-to-skills extraction pipeline for a persona.
   * Promotes high-confidence learnings/patterns into reusable skill records.
   */
  extractSkills(personaId: string, input?: ExtractSkillsInput): Promise<ExtractSkillsResult> {
    return this.http.post<ExtractSkillsResult>(`/api/personas/${personaId}/extract-skills`, input ?? {});
  }

  /**
   * Retire a persona.  Sets status = 'retired' and generates an alumni summary
   * from the persona's stats and top history entries.
   */
  retire(personaId: string, reason?: string): Promise<Persona> {
    return this.http.post<Persona>(`/api/personas/${personaId}/retire`, reason ? { reason } : {});
  }

  /**
   * Reactivate a retired persona back to active status.
   */
  reactivate(personaId: string): Promise<Persona> {
    return this.http.post<Persona>(`/api/personas/${personaId}/reactivate`, {});
  }

  /**
   * List all retired personas (alumni) with their summaries.
   */
  listAlumni(): Promise<Persona[]> {
    return this.http.get<Persona[]>('/api/personas/alumni');
  }
}
