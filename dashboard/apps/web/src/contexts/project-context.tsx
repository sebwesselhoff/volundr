'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Project } from '@vldr/shared';
import { apiFetch } from '@/lib/api-client';

interface ProjectContextType {
  project: Project | null;
  projectId: string | null;
  setProjectId: (id: string) => void;
  refetch: () => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  // Always start null for SSR — hydrate from localStorage in useEffect
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  const refetch = useCallback(() => {
    if (!projectId) return;
    apiFetch<Project>(`/api/projects/${projectId}`)
      .then(setProject)
      .catch(() => setProject(null));
  }, [projectId]);

  // Hydrate projectId from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem('vldr-active-project');
    if (stored) {
      setProjectId(stored);
    } else {
      // No stored project — fetch list and pick first
      apiFetch<Project[]>('/api/projects').then(projects => {
        if (projects.length > 0) setProjectId(projects[0].id);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      localStorage.setItem('vldr-active-project', projectId);
      refetch();
    }
  }, [projectId, refetch]);

  return (
    <ProjectContext.Provider value={{ project, projectId, setProjectId, refetch }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
