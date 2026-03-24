import type { Project, UpdateProjectInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class ProjectsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  get(): Promise<Project> {
    return this.http.get<Project>(`/api/projects/${this.projectId}`);
  }

  update(data: UpdateProjectInput): Promise<Project> {
    return this.http.patch<Project>(`/api/projects/${this.projectId}`, data);
  }
}
