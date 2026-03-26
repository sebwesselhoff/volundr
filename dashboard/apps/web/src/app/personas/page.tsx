'use client';

import { useState, useMemo } from 'react';
import type { Persona, PersonaHistoryEntry } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';

const ROLE_COLORS: Record<string, string> = {
  developer: '#3b82f6',
  architect: '#8b5cf6',
  'qa-engineer': '#22c55e',
  'devops-engineer': '#f59e0b',
  designer: '#ec4899',
  reviewer: '#14b8a6',
  guardian: '#ef4444',
  researcher: '#6366f1',
  content: '#f97316',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  inactive: '#8899b3',
  retired: '#6b7280',
};

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function ScoreBars({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, (score / 5) * 100));
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height: 4, background: '#1a2336' }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${pct}%`,
          background: pct >= 80 ? '#22c55e' : pct >= 60 ? '#e8a838' : '#ef4444',
        }}
      />
    </div>
  );
}

function PersonaCard({
  persona,
  selected,
  onSelect,
}: {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
}) {
  const roleColor = ROLE_COLORS[persona.role] ?? '#8899b3';
  const statusColor = STATUS_COLORS[persona.status] ?? '#8899b3';
  const expertise: string[] = (() => {
    try {
      return persona.expertise ? JSON.parse(persona.expertise) : [];
    } catch {
      return [];
    }
  })();

  return (
    <button
      onClick={onSelect}
      className="w-full text-left transition-all duration-200"
      style={{
        background: selected ? 'rgba(59,130,246,0.08)' : 'rgba(26,35,54,0.4)',
        border: `1px solid ${selected ? 'rgba(59,130,246,0.4)' : 'rgba(36,48,68,0.5)'}`,
        borderRadius: 8,
        padding: '1rem 1.25rem',
        cursor: 'pointer',
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 inline-block rounded-full"
            style={{ width: 8, height: 8, background: statusColor, marginTop: 2 }}
          />
          <span
            className="truncate font-medium"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '0.875rem',
              color: '#c5d0e6',
            }}
          >
            {persona.name}
          </span>
        </div>
        <span
          className="shrink-0 text-[0.65rem] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            background: `${roleColor}22`,
            color: roleColor,
            border: `1px solid ${roleColor}44`,
          }}
        >
          {persona.role}
        </span>
      </div>

      {/* Stats row */}
      <div
        className="flex items-center gap-4 mb-3"
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.7rem',
          color: '#8899b3',
        }}
      >
        <span>{persona.cardsCompleted} cards</span>
        <span>{formatTokens(persona.totalTokens)} tok</span>
        <span>{formatCost(persona.totalCost)}</span>
      </div>

      {/* Quality score bar */}
      <div className="mb-2">
        <div
          className="flex items-center justify-between mb-1"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.65rem',
            color: '#8899b3',
          }}
        >
          <span>quality avg</span>
          <span>{persona.qualityAverage.toFixed(1)}</span>
        </div>
        <ScoreBars score={persona.qualityAverage} />
      </div>

      {/* Expertise tags */}
      {expertise.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {expertise.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-[0.6rem] px-1.5 py-0.5 rounded"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                background: 'rgba(36,48,68,0.6)',
                color: '#8899b3',
                border: '1px solid rgba(36,48,68,0.8)',
              }}
            >
              {tag}
            </span>
          ))}
          {expertise.length > 4 && (
            <span
              className="text-[0.6rem] px-1.5 py-0.5 rounded"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                color: '#8899b3',
              }}
            >
              +{expertise.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

const SECTION_LABELS: Record<string, string> = {
  learnings: 'Learnings',
  decisions: 'Decisions',
  patterns: 'Patterns',
};

const SECTION_COLORS: Record<string, string> = {
  learnings: '#3b82f6',
  decisions: '#e8a838',
  patterns: '#8b5cf6',
};

function HistoryTimeline({ personaId }: { personaId: string }) {
  const { data: entries, loading } = useApiQuery<PersonaHistoryEntry[]>(
    `/api/personas/${personaId}/history`
  );
  const [activeSection, setActiveSection] = useState<string>('all');

  const sections = ['all', 'learnings', 'decisions', 'patterns'];

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (activeSection === 'all') return entries;
    return entries.filter(e => e.section === activeSection);
  }, [entries, activeSection]);

  if (loading) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.8rem',
          padding: '2rem 0',
          textAlign: 'center',
        }}
      >
        Loading history...
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.8rem',
          padding: '2rem 0',
          textAlign: 'center',
        }}
      >
        No history entries yet.
      </div>
    );
  }

  return (
    <div>
      {/* Section filter tabs */}
      <div
        className="flex gap-4 mb-5"
        style={{
          borderBottom: '1px solid rgba(36,48,68,0.5)',
          paddingBottom: 0,
        }}
      >
        {sections.map(s => {
          const active = activeSection === s;
          const color = s === 'all' ? '#c5d0e6' : SECTION_COLORS[s];
          return (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className="focus:outline-none"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0 0 0.6rem',
                position: 'relative',
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.78rem',
                fontWeight: 400,
                color: active ? '#c5d0e6' : '#8899b3',
                transition: 'color 0.15s',
              }}
            >
              {s === 'all' ? 'All' : SECTION_LABELS[s]}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: color,
                    borderRadius: 1,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="relative">
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: 7,
            width: 1,
            background: 'rgba(36,48,68,0.6)',
          }}
        />
        <div className="space-y-4 pl-6">
          {filtered.map(entry => {
            const sectionColor = SECTION_COLORS[entry.section] ?? '#8899b3';
            const stackTags: string[] = (() => {
              try {
                return entry.stackTags ? JSON.parse(entry.stackTags as unknown as string) : [];
              } catch {
                return [];
              }
            })();
            const date = new Date(entry.createdAt);
            const dateStr = date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });

            return (
              <div key={entry.id} className="relative">
                {/* Dot */}
                <span
                  className="absolute"
                  style={{
                    left: -22,
                    top: 4,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: sectionColor,
                    border: '1px solid rgba(10,14,23,0.8)',
                  }}
                />
                <div
                  style={{
                    background: 'rgba(26,35,54,0.4)',
                    border: '1px solid rgba(36,48,68,0.5)',
                    borderRadius: 6,
                    padding: '0.75rem 1rem',
                  }}
                >
                  {/* Meta row */}
                  <div
                    className="flex items-center gap-3 mb-1.5"
                    style={{
                      fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                      fontSize: '0.65rem',
                      color: '#8899b3',
                    }}
                  >
                    <span
                      style={{ color: sectionColor }}
                    >
                      {SECTION_LABELS[entry.section] ?? entry.section}
                    </span>
                    <span>{dateStr}</span>
                    {entry.confidence != null && (
                      <span>conf {(entry.confidence * 100).toFixed(0)}%</span>
                    )}
                    {entry.archivedAt && (
                      <span style={{ color: '#6b7280' }}>archived</span>
                    )}
                  </div>

                  {/* Content */}
                  <p
                    style={{
                      fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                      fontSize: '0.8rem',
                      color: entry.archivedAt ? '#6b7280' : '#c5d0e6',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {entry.content}
                  </p>

                  {/* Stack tags */}
                  {stackTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {stackTags.map(tag => (
                        <span
                          key={tag}
                          className="text-[0.6rem] px-1.5 py-0.5 rounded"
                          style={{
                            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                            background: 'rgba(36,48,68,0.6)',
                            color: '#8899b3',
                            border: '1px solid rgba(36,48,68,0.8)',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Radar Chart ───────────────────────────────────────────────────────────────

const RADAR_AXES = [
  { key: 'quality',   label: 'Quality' },
  { key: 'velocity',  label: 'Velocity' },
  { key: 'cost_eff',  label: 'Cost Eff.' },
  { key: 'expertise', label: 'Expertise' },
  { key: 'activity',  label: 'Activity' },
];

function deriveRadarValues(persona: Persona): Record<string, number> {
  // All values normalized 0–1
  const quality   = Math.min(1, (persona.qualityAverage ?? 0) / 5);
  const velocity  = Math.min(1, (persona.cardsCompleted ?? 0) / 20);
  // cost efficiency: lower cost per card = better; cap at $0.50/card
  const costPerCard = persona.cardsCompleted > 0
    ? persona.totalCost / persona.cardsCompleted
    : 0;
  const cost_eff  = Math.max(0, 1 - Math.min(1, costPerCard / 0.5));
  // expertise = number of expertise tags, capped at 8
  let expertiseArr: string[] = [];
  try { expertiseArr = persona.expertise ? JSON.parse(persona.expertise) : []; } catch { /* */ }
  const expertise = Math.min(1, expertiseArr.length / 8);
  // activity: was active recently (within 30 days)
  const daysInactive = persona.lastActiveAt
    ? (Date.now() - new Date(persona.lastActiveAt).getTime()) / 86400000
    : 9999;
  const activity = Math.max(0, 1 - Math.min(1, daysInactive / 30));

  return { quality, velocity, cost_eff, expertise, activity };
}

function PersonaRadar({ persona, roleColor }: { persona: Persona; roleColor: string }) {
  const values = deriveRadarValues(persona);
  const SIZE = 140;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = 52;
  const n = RADAR_AXES.length;

  function axisPoint(i: number, r: number) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1.0];

  const ringPath = (frac: number) => {
    return RADAR_AXES.map((_, i) => {
      const p = axisPoint(i, R * frac);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }).join(' ') + ' Z';
  };

  const dataPath = () => {
    return RADAR_AXES.map(({ key }, i) => {
      const v = values[key] ?? 0;
      const p = axisPoint(i, R * v);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }).join(' ') + ' Z';
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ flexShrink: 0 }}
      >
        {/* Grid rings */}
        {rings.map(r => (
          <path
            key={r}
            d={ringPath(r)}
            fill="none"
            stroke="rgba(36,48,68,0.7)"
            strokeWidth={0.75}
          />
        ))}

        {/* Axis lines */}
        {RADAR_AXES.map((_, i) => {
          const p = axisPoint(i, R);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={p.x.toFixed(2)}
              y2={p.y.toFixed(2)}
              stroke="rgba(36,48,68,0.6)"
              strokeWidth={0.75}
            />
          );
        })}

        {/* Data fill */}
        <path
          d={dataPath()}
          fill={`${roleColor}22`}
          stroke={roleColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Data dots */}
        {RADAR_AXES.map(({ key }, i) => {
          const v = values[key] ?? 0;
          const p = axisPoint(i, R * v);
          return (
            <circle
              key={key}
              cx={p.x.toFixed(2)}
              cy={p.y.toFixed(2)}
              r={3}
              fill={roleColor}
              stroke="rgba(10,14,23,0.8)"
              strokeWidth={1}
            />
          );
        })}

        {/* Axis labels */}
        {RADAR_AXES.map(({ label }, i) => {
          const p = axisPoint(i, R + 14);
          return (
            <text
              key={label}
              x={p.x.toFixed(2)}
              y={p.y.toFixed(2)}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: 8,
                fill: '#8899b3',
              }}
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Legend: axis values */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
        }}
      >
        {RADAR_AXES.map(({ key, label }) => {
          const v = values[key] ?? 0;
          const pct = Math.round(v * 100);
          return (
            <div
              key={key}
              className="flex items-center gap-2"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.65rem',
              }}
            >
              <span style={{ color: '#6b7280', minWidth: 58 }}>{label}</span>
              <div
                style={{
                  width: 48,
                  height: 3,
                  background: '#1a2336',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: roleColor,
                    borderRadius: 2,
                  }}
                />
              </div>
              <span style={{ color: '#8899b3', minWidth: 28 }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PersonaDetail ─────────────────────────────────────────────────────────────

function PersonaDetail({ persona }: { persona: Persona }) {
  const roleColor = ROLE_COLORS[persona.role] ?? '#8899b3';
  const statusColor = STATUS_COLORS[persona.status] ?? '#8899b3';
  const expertise: string[] = (() => {
    try {
      return persona.expertise ? JSON.parse(persona.expertise) : [];
    } catch {
      return [];
    }
  })();
  const lastActive = persona.lastActiveAt
    ? new Date(persona.lastActiveAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Never';

  return (
    <div className="kindle kindle-1">
      {/* Name and role */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span
            className="inline-block rounded-full shrink-0"
            style={{ width: 10, height: 10, background: statusColor }}
          />
          <h2
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '1.1rem',
              fontWeight: 600,
              color: '#e8ecf4',
              margin: 0,
            }}
          >
            {persona.name}
          </h2>
          <span
            className="text-[0.7rem] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              background: `${roleColor}22`,
              color: roleColor,
              border: `1px solid ${roleColor}44`,
            }}
          >
            {persona.role}
          </span>
        </div>
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.7rem',
            color: '#8899b3',
            margin: 0,
          }}
        >
          {persona.id} · last active {lastActive}
        </p>
      </div>

      {/* Radar chart */}
      <div
        className="mb-6"
        style={{
          background: 'rgba(26,35,54,0.4)',
          border: '1px solid rgba(36,48,68,0.5)',
          borderRadius: 6,
          padding: '1rem',
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
          }}
        >
          Expertise Profile
        </p>
        <PersonaRadar persona={persona} roleColor={roleColor} />
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-2 gap-3 mb-6"
        style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
      >
        {[
          { label: 'Cards Completed', value: String(persona.cardsCompleted) },
          { label: 'Quality Avg', value: `${persona.qualityAverage.toFixed(2)} / 5` },
          { label: 'Total Tokens', value: formatTokens(persona.totalTokens) },
          { label: 'Total Cost', value: formatCost(persona.totalCost) },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 6,
              padding: '0.75rem 1rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.65rem',
                color: '#8899b3',
                margin: '0 0 0.25rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {label}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.95rem',
                color: '#c5d0e6',
                margin: 0,
                fontWeight: 500,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Quality bar */}
      <div
        className="mb-6"
        style={{
          background: 'rgba(26,35,54,0.4)',
          border: '1px solid rgba(36,48,68,0.5)',
          borderRadius: 6,
          padding: '0.75rem 1rem',
        }}
      >
        <div
          className="flex items-center justify-between mb-2"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.7rem',
            color: '#8899b3',
          }}
        >
          <span>Quality Score</span>
          <span>{persona.qualityAverage.toFixed(2)} / 5.00</span>
        </div>
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: 6, background: '#1a2336' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, (persona.qualityAverage / 5) * 100)}%`,
              background:
                persona.qualityAverage >= 4
                  ? '#22c55e'
                  : persona.qualityAverage >= 3
                  ? '#e8a838'
                  : '#ef4444',
            }}
          />
        </div>
      </div>

      {/* Model & style */}
      {(persona.modelPreference || persona.style) && (
        <div className="mb-6 space-y-2">
          {persona.modelPreference && (
            <div
              className="flex items-center gap-2"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.72rem',
                color: '#8899b3',
              }}
            >
              <span style={{ color: '#6b7280' }}>model</span>
              <span>{persona.modelPreference}</span>
            </div>
          )}
          {persona.style && (
            <div
              className="flex items-start gap-2"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.78rem',
                color: '#8899b3',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  color: '#6b7280',
                  fontSize: '0.72rem',
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                style
              </span>
              <span>{persona.style}</span>
            </div>
          )}
        </div>
      )}

      {/* Expertise */}
      {expertise.length > 0 && (
        <div className="mb-6">
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.5rem',
            }}
          >
            Expertise
          </p>
          <div className="flex flex-wrap gap-1.5">
            {expertise.map(tag => (
              <span
                key={tag}
                className="text-[0.7rem] px-2 py-0.5 rounded"
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  background: 'rgba(59,130,246,0.1)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.3)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* History Timeline */}
      <div>
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.65rem',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '0 0 1rem',
          }}
        >
          History Timeline
        </p>
        <HistoryTimeline personaId={persona.id} />
      </div>
    </div>
  );
}

export default function PersonasPage() {
  const { data: personas, loading } = useApiQuery<Persona[]>('/api/personas');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!personas) return [];
    let list = personas;
    if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.role.toLowerCase().includes(q)
      );
    }
    return list;
  }, [personas, search, statusFilter]);

  const selectedPersona = useMemo(
    () => personas?.find(p => p.id === selectedId) ?? null,
    [personas, selectedId]
  );

  // Auto-select first result
  const firstFiltered = filtered[0];
  const effectiveSelected = selectedPersona ?? firstFiltered ?? null;

  return (
    <div
      className="px-6 py-10"
      style={{ maxWidth: 1140, margin: '0 auto' }}
    >
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
          Personas
        </h1>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-4 mb-6 kindle kindle-1">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search personas..."
          className={[
            'flex-1 bg-transparent text-[0.85rem] text-[#c5d0e6]',
            'border-0 border-b border-[#243044]',
            'focus:border-[#3b82f6] focus:outline-none',
            'placeholder:text-[#8899b3]',
            'pb-2 transition-colors duration-200',
            '[box-shadow:none]',
            'focus:[box-shadow:0_1px_0_0_#3b82f640]',
          ].join(' ')}
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          }}
        />

        {/* Status filter */}
        {(['all', 'active', 'inactive', 'retired'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.7rem',
              color:
                statusFilter === s
                  ? s === 'active'
                    ? '#22c55e'
                    : s === 'inactive'
                    ? '#8899b3'
                    : s === 'retired'
                    ? '#6b7280'
                    : '#c5d0e6'
                  : '#6b7280',
              padding: '0.25rem 0.5rem',
              borderRadius: 4,
              background:
                statusFilter === s ? 'rgba(36,48,68,0.5)' : 'transparent',
            } as React.CSSProperties}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: persona list */}
        <div style={{ width: 320, flexShrink: 0 }}>
          {loading ? (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Loading personas...
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              No personas found.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((p, i) => (
                <div
                  key={p.id}
                  className={`kindle kindle-${Math.min(i + 1, 5)}`}
                >
                  <PersonaCard
                    persona={p}
                    selected={effectiveSelected?.id === p.id}
                    onSelect={() => setSelectedId(p.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0">
          {effectiveSelected ? (
            <PersonaDetail persona={effectiveSelected} />
          ) : (
            <div
              className="text-center py-24"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Select a persona to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
