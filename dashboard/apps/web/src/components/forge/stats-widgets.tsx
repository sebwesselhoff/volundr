'use client';

import type { MetricsResponse, Persona, Skill } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

interface WidgetProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

function Widget({ label, value, sub, color = '#c5d0e6' }: WidgetProps) {
  return (
    <div
      style={{
        background: 'rgba(26,35,54,0.35)',
        border: '1px solid rgba(36,48,68,0.5)',
        borderRadius: 6,
        padding: '0.75rem 1rem',
        minWidth: 120,
        flex: '1 1 120px',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.6rem',
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          margin: '0 0 0.3rem',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '1.2rem',
          color,
          margin: 0,
          fontWeight: 500,
          lineHeight: 1,
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.62rem',
            color: '#8899b3',
            margin: '0.25rem 0 0',
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function StatsWidgets() {
  const { projectId } = useProject();

  const { data: metrics } = useApiQuery<MetricsResponse>(
    projectId ? `/api/projects/${projectId}/metrics` : null
  );
  const { data: personas } = useApiQuery<Persona[]>('/api/personas');
  const { data: skills } = useApiQuery<Skill[]>('/api/skills');

  // Compliance: % of quality scores >= 5.0 from the trend (1-10 scale)
  const trend = metrics?.qualityTrend ?? [];
  const compliant = trend.filter(d => d.score >= 5.0).length;
  const compliancePct = trend.length > 0 ? Math.round((compliant / trend.length) * 100) : null;

  const activePersonas = personas?.filter(p => p.status === 'active').length ?? null;
  const totalPersonas = personas?.length ?? null;

  const skillCount = skills?.length ?? null;

  const complianceColor =
    compliancePct == null
      ? '#8899b3'
      : compliancePct >= 80
      ? '#22c55e'
      : compliancePct >= 60
      ? '#e8a838'
      : '#ef4444';

  return (
    <section>
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#8899b3] mb-3">
        AT A GLANCE
      </p>
      <div className="flex flex-wrap gap-3">
        <Widget
          label="Compliance"
          value={compliancePct != null ? `${compliancePct}%` : '—'}
          sub={trend.length > 0 ? `${compliant}/${trend.length} scored` : 'no data'}
          color={complianceColor}
        />
        <Widget
          label="Personas"
          value={activePersonas != null ? activePersonas : '—'}
          sub={totalPersonas != null ? `${totalPersonas} total` : undefined}
          color="#3b82f6"
        />
        <Widget
          label="Skills"
          value={skillCount != null ? skillCount : '—'}
          sub="in library"
          color="#8b5cf6"
        />
        {metrics && (
          <Widget
            label="Total Cost"
            value={formatCost(metrics.totalEstimatedCost)}
            sub={`${metrics.totalAgentsSpawned} agents`}
            color="#e8a838"
          />
        )}
      </div>
    </section>
  );
}
