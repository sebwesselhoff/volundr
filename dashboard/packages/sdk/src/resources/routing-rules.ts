import type { RoutingRule, CreateRoutingRuleInput, UpdateRoutingRuleInput } from '@vldr/shared';
import type { HttpClient } from '../http.js';

export interface RoutingRuleTestInput {
  description: string;
}

export class RoutingRulesResource {
  constructor(private http: HttpClient) {}

  list(): Promise<RoutingRule[]> {
    return this.http.get<RoutingRule[]>('/api/routing-rules');
  }

  get(id: number): Promise<RoutingRule> {
    return this.http.get<RoutingRule>(`/api/routing-rules/${id}`);
  }

  create(data: CreateRoutingRuleInput): Promise<RoutingRule> {
    return this.http.post<RoutingRule>('/api/routing-rules', data);
  }

  update(id: number, data: UpdateRoutingRuleInput): Promise<RoutingRule> {
    return this.http.patch<RoutingRule>(`/api/routing-rules/${id}`, data);
  }

  delete(id: number, hard = false): Promise<void> {
    return this.http.delete<void>(`/api/routing-rules/${id}${hard ? '?hard=true' : ''}`);
  }

  test(input: RoutingRuleTestInput): Promise<{ description: string; matched: RoutingRule[] }> {
    return this.http.post<{ description: string; matched: RoutingRule[] }>('/api/routing-rules/test', input);
  }
}
