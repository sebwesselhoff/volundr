'use client';

import { useMemo } from 'react';
import { SCORE_SCALE, type QualityScore, type Directive } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';

// --- Utility helpers ---

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function scoreColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#e8a838';
  return '#ef4444';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// --- Gauge component ---

function EnforcementGauge({ pct }: { pct: number }) {
  const color = scoreColor(pct);
  // SVG arc gauge — 220° sweep
  const R = 52;
  const cx = 70;
  const cy = 70;
  const sweep = 220; // degrees
  const startDeg = 270 - sweep / 2; // 160°
  const endDeg = 270 + sweep / 2;   // 380° = 20°

  function polarToXY(deg: number, r: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const arcPath = (from: number, to: number, r: number) => {
    const s = polarToXY(from, r);
    const e = polarToXY(to, r);
    const large = to - from > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const fillEnd = startDeg + (sweep * pct) / 100;

  return (
    <svg
      width={140}
      height={100}
      viewBox={`0 0 140 100`}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Track */}
      <path
        d={arcPath(startDeg, endDeg, R)}
        fill="none"
        stroke="#1a2336"
        strokeWidth={10}
        strokeLinecap="round"
      />
      {/* Fill */}
      {pct > 0 && (
        <path
          d={arcPath(startDeg, fillEnd, R)}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      )}
      {/* Label */}
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 18,
          fill: color,
          fontWeight: 600,
        }}
      >
        {Math.round(pct)}
      </text>
      <text
        x={cx}
        y={cy + 20}
        textAnchor="middle"
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 8,
          fill: '#8899b3',
        }}
      >
        / 100
      </text>
    </svg>
  );
}

// --- Quality heatmap cell ---

const HEATMAP_METRICS: Array<{ key: keyof QualityScore; label: string }> = [
  { key: 'completeness', label: 'Complete' },
  { key: 'codeQuality', label: 'Code Q' },
  { key: 'formatCompliance', label: 'Format' },
  { key: 'independence', label: 'Indep.' },
];

function heatColor(v: number): string {
  // 0–10 scale mapped to a dark-to-bright spectrum
  const pct = clamp(v / SCORE_SCALE, 0, 1);
  if (pct >= 0.8) return '#22c55e';
  if (pct >= 0.6) return '#84cc16';
  if (pct >= 0.4) return '#e8a838';
  if (pct >= 0.2) return '#f97316';
  return '#ef4444';
}

function QualityHeatmap({ scores }: { scores: QualityScore[] }) {
  if (scores.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.8rem',
          padding: '1.5rem 0',
          textAlign: 'center',
        }}
      >
        No quality scores yet.
      </div>
    );
  }

  // Show latest 20 sorted by date
  const recent = [...scores]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <thead>
          <tr>
            <th
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.62rem',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '0 0.75rem 0.5rem 0',
                textAlign: 'left',
                fontWeight: 400,
              }}
            >
              Card
            </th>
            {HEATMAP_METRICS.map(m => (
              <th
                key={m.key}
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.62rem',
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0 0.5rem 0.5rem',
                  textAlign: 'center',
                  fontWeight: 400,
                }}
              >
                {m.label}
              </th>
            ))}
            <th
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.62rem',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '0 0 0.5rem 0.5rem',
                textAlign: 'center',
                fontWeight: 400,
              }}
            >
              Weighted
            </th>
          </tr>
        </thead>
        <tbody>
          {recent.map((qs, i) => (
            <tr
              key={qs.id}
              style={{
                background: i % 2 === 0 ? 'rgba(26,35,54,0.3)' : 'transparent',
              }}
            >
              <td
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.7rem',
                  color: '#8899b3',
                  padding: '0.4rem 0.75rem 0.4rem 0.25rem',
                  whiteSpace: 'nowrap',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {qs.cardId}
              </td>
              {HEATMAP_METRICS.map(m => {
                const val = qs[m.key] as number;
                return (
                  <td key={m.key} style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                    <span
                      title={String(val)}
                      style={{
                        display: 'inline-block',
                        width: 28,
                        height: 20,
                        borderRadius: 3,
                        background: heatColor(val),
                        opacity: 0.85,
                        verticalAlign: 'middle',
                      }}
                    />
                    <span
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                        fontSize: '0.6rem',
                        color: '#8899b3',
                        marginTop: 1,
                      }}
                    >
                      {val}
                    </span>
                  </td>
                );
              })}
              <td style={{ padding: '0.4rem 0.25rem 0.4rem 0.5rem', textAlign: 'center' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                    fontSize: '0.72rem',
                    color: heatColor(qs.weightedScore),
                    fontWeight: 600,
                  }}
                >
                  {qs.weightedScore.toFixed(1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Violations list ---

const SOURCE_COLORS: Record<string, string> = {
  confirmed: '#22c55e',
  manual: '#3b82f6',
  imported: '#8b5cf6',
};

function ViolationsList({ directives }: { directives: Directive[] }) {
  const active = directives.filter(d => d.status === 'active');
  const suppressed = directives.filter(d => d.status === 'suppressed');
  const superseded = directives.filter(d => d.status === 'superseded');

  if (active.length === 0 && suppressed.length === 0 && superseded.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.8rem',
          padding: '1.5rem 0',
          textAlign: 'center',
        }}
      >
        No directives found.
      </div>
    );
  }

  const groups: Array<{ label: string; items: Directive[]; color: string }> = [
    { label: 'Active', items: active, color: '#22c55e' },
    { label: 'Suppressed', items: suppressed, color: '#8899b3' },
    { label: 'Superseded', items: superseded, color: '#6b7280' },
  ].filter(g => g.items.length > 0);

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group.label}>
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: group.color,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.75rem',
            }}
          >
            {group.label} ({group.items.length})
          </p>
          <div className="space-y-2">
            {group.items.map(d => (
              <div
                key={d.id}
                style={{
                  background: 'rgba(26,35,54,0.4)',
                  border: `1px solid ${
                    d.status === 'active'
                      ? 'rgba(36,48,68,0.5)'
                      : 'rgba(36,48,68,0.3)'
                  }`,
                  borderRadius: 6,
                  padding: '0.625rem 0.875rem',
                  opacity: d.status !== 'active' ? 0.6 : 1,
                }}
              >
                <div
                  className="flex items-start justify-between gap-3 mb-1"
                >
                  <p
                    style={{
                      fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                      fontSize: '0.8rem',
                      color: '#c5d0e6',
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {d.content}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      style={{
                        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                        fontSize: '0.6rem',
                        color: SOURCE_COLORS[d.source] ?? '#8899b3',
                        background: `${SOURCE_COLORS[d.source] ?? '#8899b3'}18`,
                        border: `1px solid ${SOURCE_COLORS[d.source] ?? '#8899b3'}33`,
                        borderRadius: 3,
                        padding: '1px 5px',
                      }}
                    >
                      {d.source}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                        fontSize: '0.6rem',
                        color: '#6b7280',
                      }}
                    >
                      p{d.priority}
                    </span>
                  </div>
                </div>
                <p
                  style={{
                    fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                    fontSize: '0.62rem',
                    color: '#6b7280',
                    margin: 0,
                  }}
                >
                  #{d.id} · {formatDate(d.createdAt)}
                  {d.supersededBy != null && (
                    <span> · superseded by #{d.supersededBy}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Main page ---

export default function CompliancePage() {
  const { projectId } = useProject();

  const { data: qualityScores, loading: qualityLoading } = useApiQuery<QualityScore[]>(
    projectId ? `/api/projects/${projectId}/quality` : null
  );
  const { data: directives, loading: directivesLoading } = useApiQuery<Directive[]>(
    projectId ? `/api/projects/${projectId}/directives` : null
  );

  // Compute enforcement score:
  // - Quality component (70%): average weighted score across all cards, normalized to 100
  // - Directive health (30%): % of directives that are active (not suppressed/superseded)
  const { enforcementScore, qualityAvg, directiveHealth, metricAverages } = useMemo(() => {
    const scores = qualityScores ?? [];
    const dirs = directives ?? [];

    const qualityAvg =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s.weightedScore, 0) / scores.length
        : 0;
    const qualityPct = clamp((qualityAvg / SCORE_SCALE) * 100, 0, 100);

    const totalDirs = dirs.length;
    const activeDirs = dirs.filter(d => d.status === 'active').length;
    const directiveHealth =
      totalDirs > 0 ? clamp((activeDirs / totalDirs) * 100, 0, 100) : 100;

    const enforcementScore = qualityPct * 0.7 + directiveHealth * 0.3;

    // Per-metric averages
    const metricAverages =
      scores.length > 0
        ? {
            completeness: scores.reduce((s, q) => s + q.completeness, 0) / scores.length,
            codeQuality: scores.reduce((s, q) => s + q.codeQuality, 0) / scores.length,
            formatCompliance: scores.reduce((s, q) => s + q.formatCompliance, 0) / scores.length,
            independence: scores.reduce((s, q) => s + q.independence, 0) / scores.length,
          }
        : null;

    return { enforcementScore, qualityAvg, directiveHealth, metricAverages };
  }, [qualityScores, directives]);

  if (!projectId) {
    return (
      <div
        className="text-center py-24 kindle kindle-2"
        style={{
          maxWidth: 1140,
          margin: '0 auto',
          paddingLeft: '1.5rem',
          paddingRight: '1.5rem',
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.85rem',
        }}
      >
        Select a project to view compliance.
      </div>
    );
  }

  const loading = qualityLoading || directivesLoading;

  return (
    <div className="px-6 py-10" style={{ maxWidth: 1140, margin: '0 auto' }}>
      {/* Header */}
      <div className="mb-6 kindle">
        <h1
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '1rem',
            fontWeight: 600,
            color: '#c5d0e6',
            margin: 0,
            letterSpacing: '0.02em',
          }}
        >
          Compliance
        </h1>
      </div>

      {loading ? (
        <div
          className="text-center py-24"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            color: '#8899b3',
            fontSize: '0.85rem',
          }}
        >
          Loading...
        </div>
      ) : (
        <div className="space-y-8">
          {/* Top row: gauge + breakdown */}
          <div
            className="flex gap-6 kindle kindle-1"
            style={{ alignItems: 'flex-start' }}
          >
            {/* Enforcement gauge */}
            <div
              style={{
                background: 'rgba(26,35,54,0.4)',
                border: '1px solid rgba(36,48,68,0.5)',
                borderRadius: 8,
                padding: '1.5rem',
                minWidth: 200,
                flexShrink: 0,
              }}
            >
              <p
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.62rem',
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  margin: '0 0 0.75rem',
                  textAlign: 'center',
                }}
              >
                Enforcement Score
              </p>
              <EnforcementGauge pct={enforcementScore} />
              <div
                className="flex justify-between mt-3"
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.62rem',
                  color: '#8899b3',
                }}
              >
                <span>Quality {(qualityAvg / SCORE_SCALE * 100).toFixed(0)}%</span>
                <span>Directives {directiveHealth.toFixed(0)}%</span>
              </div>
            </div>

            {/* Breakdown bars */}
            {metricAverages ? (
              <div
                className="flex-1"
                style={{
                  background: 'rgba(26,35,54,0.4)',
                  border: '1px solid rgba(36,48,68,0.5)',
                  borderRadius: 8,
                  padding: '1.5rem',
                }}
              >
                <p
                  style={{
                    fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                    fontSize: '0.62rem',
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    margin: '0 0 1.25rem',
                  }}
                >
                  Metric Averages
                </p>
                <div className="space-y-4">
                  {(
                    [
                      { key: 'completeness', label: 'Completeness' },
                      { key: 'codeQuality', label: 'Code Quality' },
                      { key: 'formatCompliance', label: 'Format Compliance' },
                      { key: 'independence', label: 'Independence' },
                    ] as const
                  ).map(({ key, label }) => {
                    const val = metricAverages[key];
                    const pct = (val / SCORE_SCALE) * 100;
                    return (
                      <div key={key}>
                        <div
                          className="flex items-center justify-between mb-1.5"
                          style={{
                            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                            fontSize: '0.7rem',
                            color: '#8899b3',
                          }}
                        >
                          <span>{label}</span>
                          <span style={{ color: scoreColor(pct) }}>
                            {val.toFixed(2)} / {SCORE_SCALE}
                          </span>
                        </div>
                        <div
                          className="w-full rounded-full overflow-hidden"
                          style={{ height: 5, background: '#1a2336' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: scoreColor(pct),
                              transition: 'width 0.6s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Score count */}
                <p
                  style={{
                    fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                    fontSize: '0.62rem',
                    color: '#6b7280',
                    margin: '1.25rem 0 0',
                  }}
                >
                  Based on {qualityScores?.length ?? 0} scored card
                  {(qualityScores?.length ?? 0) !== 1 ? 's' : ''}
                </p>
              </div>
            ) : (
              <div
                className="flex-1 flex items-center justify-center"
                style={{
                  background: 'rgba(26,35,54,0.4)',
                  border: '1px solid rgba(36,48,68,0.5)',
                  borderRadius: 8,
                  padding: '1.5rem',
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  color: '#8899b3',
                  fontSize: '0.82rem',
                }}
              >
                No quality scores yet.
              </div>
            )}
          </div>

          {/* Heatmap */}
          <div
            className="kindle kindle-2"
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 8,
              padding: '1.5rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.62rem',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: '0 0 1rem',
              }}
            >
              Quality Heatmap (latest 20)
            </p>
            <QualityHeatmap scores={qualityScores ?? []} />
          </div>

          {/* Directives / Violations */}
          <div
            className="kindle kindle-3"
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 8,
              padding: '1.5rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.62rem',
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: '0 0 1rem',
              }}
            >
              Directives ({directives?.length ?? 0})
            </p>
            <ViolationsList directives={directives ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
