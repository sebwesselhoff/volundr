'use client';

import { useState } from 'react';
import type { MetricsResponse, Agent } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';
import { MetricsTab } from '@/components/insights/metrics-tab';
import { AgentsTab } from '@/components/insights/agents-tab';

type Tab = 'metrics' | 'agents';

const TABS: { id: Tab; label: string }[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'agents',  label: 'Agents' },
];

export default function InsightsPage() {
  const { projectId } = useProject();
  const [activeTab, setActiveTab] = useState<Tab>('metrics');

  const { data: metrics, loading: metricsLoading } = useApiQuery<MetricsResponse>(
    projectId ? `/api/projects/${projectId}/metrics` : null
  );
  const { data: agents, loading: agentsLoading } = useApiQuery<Agent[]>(
    projectId ? `/api/projects/${projectId}/agents` : null
  );

  return (
    <div className="px-6 py-10" style={{ maxWidth: 1140, margin: '0 auto' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: '2rem',
          marginBottom: '2.5rem',
          borderBottom: '1px solid rgba(36,48,68,0.5)',
          paddingBottom: 0,
        }}
        className="kindle"
      >
        {TABS.map(({ id, label }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="focus:outline-none"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0 0 0.75rem',
                position: 'relative',
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontWeight: 400,
                fontSize: '0.85rem',
                color: active ? '#c5d0e6' : '#8899b3',
                transition: 'color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
              {active && (
                <span style={{
                  position: 'absolute',
                  bottom: -1,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: '#3b82f6',
                  borderRadius: 1,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* No project state */}
      {!projectId ? (
        <div
          className="text-center py-24 kindle kindle-2"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            color: '#8899b3',
            fontSize: '0.85rem',
          }}
        >
          Select a project to view insights.
        </div>
      ) : (
        <>
          {activeTab === 'metrics' && (
            <div className="kindle kindle-1">
              <MetricsTab metrics={metrics} loading={metricsLoading} />
            </div>
          )}
          {activeTab === 'agents' && (
            <div className="kindle kindle-1">
              <AgentsTab agents={agents} loading={agentsLoading} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
