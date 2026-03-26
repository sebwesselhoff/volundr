import type { Command, CeremonyEvaluationResult, CeremonyEvaluateInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class CeremoniesResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  evaluate(input?: CeremonyEvaluateInput): Promise<CeremonyEvaluationResult> {
    return this.http.post<CeremonyEvaluationResult>(
      `/api/projects/${this.projectId}/ceremonies/evaluate`,
      input ?? {},
    );
  }

  pending(): Promise<Command[]> {
    return this.http.get<Command[]>(`/api/projects/${this.projectId}/ceremonies/pending`);
  }

  acknowledge(commandId: string): Promise<Command> {
    return this.http.post<Command>(
      `/api/projects/${this.projectId}/ceremonies/acknowledge`,
      { commandId },
    );
  }
}
