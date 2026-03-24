import type { Lesson, CreateLessonInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface LessonFilters {
  isGlobal?: boolean;
}

export interface ExportedLesson {
  title: string;
  content: string;
  stack: string;
  source: string;
}

export class LessonsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  list(filters?: LessonFilters): Promise<Lesson[]> {
    const params = new URLSearchParams();
    if (filters?.isGlobal !== undefined) {
      params.set('isGlobal', String(filters.isGlobal));
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<Lesson[]>(`/api/projects/${this.projectId}/lessons${qs}`);
  }

  create(data: Omit<CreateLessonInput, 'projectId'>): Promise<Lesson> {
    return this.http.post<Lesson>(`/api/lessons`, { ...data, projectId: this.projectId });
  }

  /** Export all global lessons in seed.json format for community sharing */
  export(): Promise<ExportedLesson[]> {
    return this.http.get<ExportedLesson[]>(`/api/lessons/export`);
  }
}
