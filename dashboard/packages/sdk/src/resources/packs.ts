import type { HttpClient } from '../http.js';

export interface PackManifest {
  name: string;
  version: string;
  description: string;
  alwaysLoad: boolean;
  agentTypes: string[];
  signals: string[];
}

export interface PackPersonaSeed {
  id: string;
  name: string;
  role: string;
  expertise: string;
  style?: string;
  modelPreference?: string;
}

export interface InstallPackInput {
  projectId: string;
  manifest: PackManifest;
  personas?: PackPersonaSeed[];
}

export interface InstallPackResult {
  pack: string;
  version: string;
  personasRegistered: string[];
  personasSkipped: string[];
  agentTypesActivated: string[];
}

export interface InstalledPack {
  pack: string;
  version: string;
  installedAt: string;
}

export class PacksResource {
  constructor(private http: HttpClient) {}

  install(input: InstallPackInput): Promise<InstallPackResult> {
    return this.http.post<InstallPackResult>('/api/packs/install', input);
  }

  listInstalled(projectId: string): Promise<InstalledPack[]> {
    return this.http.get<InstalledPack[]>(`/api/packs/installed/${projectId}`);
  }
}
