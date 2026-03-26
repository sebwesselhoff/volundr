import type { Directive, CreateDirectiveInput, UpdateDirectiveInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface DirectiveFilters {
  status?: string;
}

export class DirectivesResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: DirectiveFilters): Promise<Directive[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Directive[]>(`/api/projects/${this.projectId}/directives${qs}`);
  }

  listGlobal(filters?: DirectiveFilters): Promise<Directive[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Directive[]>(`/api/directives${qs}`);
  }

  get(id: number): Promise<Directive> {
    return this.http.get<Directive>(`/api/directives/${id}`);
  }

  create(data: Omit<CreateDirectiveInput, 'projectId'>): Promise<Directive> {
    return this.http.post<Directive>(`/api/projects/${this.projectId}/directives`, data);
  }

  createGlobal(data: CreateDirectiveInput): Promise<Directive> {
    return this.http.post<Directive>('/api/directives', data);
  }

  update(id: number, data: UpdateDirectiveInput): Promise<Directive> {
    return this.http.patch<Directive>(`/api/directives/${id}`, data);
  }

  delete(id: number, hard = false): Promise<void> {
    return this.http.delete<void>(`/api/directives/${id}${hard ? '?hard=true' : ''}`);
  }
}
