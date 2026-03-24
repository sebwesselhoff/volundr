'use client';

import type { MetricsResponse } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';

function TrendArrow({ trend }: { trend: Array<{ score: number }> }) {
  if (!trend || trend.length < 2) {
    return <span className="text-[#8899b3] text-sm ml-1">—</span>;
  }
  const last = trend[trend.length - 1]?.score ?? 0;
  const prev = trend[trend.length - 2]?.score ?? 0;
  const delta = last - prev;
  if (delta > 0) return <span className="text-[#e8a838] text-sm ml-1">↑</span>;
  if (delta < 0) return <span className="text-[#d4581a] text-sm ml-1">↓</span>;
  return <span className="text-[#8899b3] text-sm ml-1">→</span>;
}

interface ProgressFillProps {
  fraction: number;
}

function ProgressFill({ fraction }: ProgressFillProps) {
  const pct = Math.min(100, Math.max(0, fraction * 100));

  return (
    <div
      className="relative h-[2px] rounded-full overflow-hidden"
      style={{ background: '#1a2233', width: '100%' }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s linear infinite',
        }}
      />
    </div>
  );
}

export function ProgressBar() {
  const { projectId } = useProject();
  const { data: metrics, loading } = useApiQuery<MetricsResponse>(
    projectId ? `/api/projects/${projectId}/metrics` : null
  );

  const cardsByStatus = metrics?.cardsByStatus ?? {};
  const completedCards = (cardsByStatus['done'] ?? 0) + (cardsByStatus['skipped'] ?? 0);
  const totalCards = Object.values(cardsByStatus).reduce((sum, n) => sum + n, 0);
  const fraction = totalCards > 0 ? completedCards / totalCards : 0;

  const qualityAvg = metrics?.averageQualityScore ?? 0;
  const qualityTrend = metrics?.qualityTrend ?? [];

  if (loading && !metrics) {
    return (
      <section>
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#8899b3] mb-3">
          PROGRESS
        </p>
        <div className="h-12 flex items-center">
          <span className="text-[0.8rem] text-[#8899b3]">Loading…</span>
        </div>
      </section>
    );
  }

  return (
    <section>
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#8899b3] mb-3">
        PROGRESS
      </p>
      <div className="flex justify-between items-start max-w-[800px] mx-auto gap-8">

        {/* Cards block */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span
              className="font-medium text-[#e8a838]"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '1.5rem',
              }}
            >
              {completedCards}/{totalCards}
            </span>
            <span className="text-[0.75rem] text-[#8899b3] uppercase tracking-[0.08em]">
              cards
            </span>
          </div>
          <ProgressFill fraction={fraction} />
        </div>

        {/* Divider */}
        <div
          className="flex-shrink-0 self-stretch"
          style={{ width: 1, background: 'rgba(36,48,68,0.8)' }}
        />

        {/* Quality block */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-baseline gap-1">
            <span
              className="font-medium text-[#3b82f6]"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '1.5rem',
              }}
            >
              {qualityAvg > 0 ? qualityAvg.toFixed(1) : '—'}
            </span>
            <TrendArrow trend={qualityTrend} />
            <span className="text-[0.75rem] text-[#8899b3] uppercase tracking-[0.08em] ml-1">
              quality
            </span>
          </div>
          <div
            className="h-[2px] rounded-full"
            style={{ background: '#1a2233' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (qualityAvg / 5) * 100)}%`,
                background: '#3b82f6',
              }}
            />
          </div>
        </div>

      </div>
    </section>
  );
}
