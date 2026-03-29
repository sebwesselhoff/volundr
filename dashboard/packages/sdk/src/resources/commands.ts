import type { Command, CreateCommandInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export class CommandsResource {
  constructor(
    private http: HttpClient,
    private projectId: string,
  ) {}

  pending(): Promise<Command[]> {
    return this.http.get<Command[]>(`/api/projects/${this.projectId}/commands/pending`);
  }

  create(data: CreateCommandInput): Promise<Command> {
    return this.http.post<Command>('/api/commands', data);
  }

  ack(commandId: string, success: boolean, detail?: string): Promise<Command> {
    return this.http.post<Command>(`/api/commands/${commandId}/ack`, { success, detail });
  }
}
