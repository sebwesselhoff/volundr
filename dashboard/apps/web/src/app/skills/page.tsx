'use client';

import { useState, useMemo } from 'react';
import type { Skill } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#22c55e',
  medium: '#e8a838',
  low: '#ef4444',
};

const CONFIDENCE_BG: Record<string, string> = {
  high: 'rgba(34,197,94,0.1)',
  medium: 'rgba(232,168,56,0.1)',
  low: 'rgba(239,68,68,0.1)',
};

const DOMAIN_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b',
  '#ec4899', '#14b8a6', '#ef4444', '#6366f1', '#f97316',
];

function getDomainColor(domain: string, domains: string[]): string {
  const idx = domains.indexOf(domain);
  return DOMAIN_COLORS[idx % DOMAIN_COLORS.length] ?? '#8899b3';
}

function isStale(reviewByDate: string): boolean {
  try {
    return new Date(reviewByDate) < new Date();
  } catch {
    return false;
  }
}

function SkillRow({
  skill,
  selected,
  onSelect,
  domainColor,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
  domainColor: string;
}) {
  const stale = isStale(skill.reviewByDate);

  return (
    <button
      onClick={onSelect}
      className="w-full text-left transition-all duration-150"
      style={{
        background: selected ? 'rgba(59,130,246,0.08)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(59,130,246,0.4)' : 'transparent'}`,
        borderRadius: 6,
        padding: '0.65rem 0.875rem',
        cursor: 'pointer',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <span
          className="truncate font-medium"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.82rem',
            color: '#c5d0e6',
          }}
        >
          {skill.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {stale && (
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.6rem',
                color: '#ef4444',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 3,
                padding: '0 4px',
              }}
            >
              stale
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: CONFIDENCE_COLORS[skill.confidence] ?? '#8899b3',
              background: CONFIDENCE_BG[skill.confidence] ?? 'transparent',
              border: `1px solid ${CONFIDENCE_COLORS[skill.confidence] ?? '#8899b3'}44`,
              borderRadius: 3,
              padding: '0 4px',
            }}
          >
            {skill.confidence}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 inline-block rounded-full"
          style={{ width: 6, height: 6, background: domainColor }}
        />
        <span
          className="truncate"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.68rem',
            color: '#8899b3',
          }}
        >
          {skill.domain}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.65rem',
            color: '#6b7280',
          }}
        >
          v{skill.version}
        </span>
      </div>
    </button>
  );
}

function SkillDetail({ skill, domainColor }: { skill: Skill; domainColor: string }) {
  const stale = isStale(skill.reviewByDate);
  const validatedDate = new Date(skill.validatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const reviewDate = new Date(skill.reviewByDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="kindle kindle-1">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '1.05rem',
              fontWeight: 600,
              color: '#e8ecf4',
              margin: 0,
            }}
          >
            {skill.name}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {stale && (
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.65rem',
                  color: '#ef4444',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                stale
              </span>
            )}
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.68rem',
                color: CONFIDENCE_COLORS[skill.confidence] ?? '#8899b3',
                background: CONFIDENCE_BG[skill.confidence] ?? 'transparent',
                border: `1px solid ${CONFIDENCE_COLORS[skill.confidence] ?? '#8899b3'}44`,
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              {skill.confidence}
            </span>
          </div>
        </div>
        <div
          className="flex items-center gap-3"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.68rem',
            color: '#8899b3',
          }}
        >
          <span
            className="flex items-center gap-1.5"
          >
            <span
              className="inline-block rounded-full"
              style={{ width: 6, height: 6, background: domainColor }}
            />
            <span style={{ color: domainColor }}>{skill.domain}</span>
          </span>
          <span>{skill.id}</span>
          <span>v{skill.version}</span>
        </div>
      </div>

      {/* Description */}
      <div
        className="mb-5"
        style={{
          background: 'rgba(26,35,54,0.4)',
          border: '1px solid rgba(36,48,68,0.5)',
          borderRadius: 6,
          padding: '0.875rem 1rem',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.82rem',
            color: '#c5d0e6',
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          {skill.description}
        </p>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Source', value: skill.source },
          { label: 'Validated', value: validatedDate },
          { label: 'Review By', value: reviewDate, warn: stale },
        ].map(({ label, value, warn }) => (
          <div
            key={label}
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: `1px solid ${warn ? 'rgba(239,68,68,0.3)' : 'rgba(36,48,68,0.5)'}`,
              borderRadius: 6,
              padding: '0.625rem 0.875rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.6rem',
                color: '#8899b3',
                margin: '0 0 0.2rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {label}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.75rem',
                color: warn ? '#ef4444' : '#c5d0e6',
                margin: 0,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Triggers */}
      {skill.triggers.length > 0 && (
        <div className="mb-5">
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.5rem',
            }}
          >
            Triggers
          </p>
          <div className="flex flex-wrap gap-1.5">
            {skill.triggers.map(t => (
              <span
                key={t}
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.68rem',
                  background: 'rgba(59,130,246,0.08)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.25)',
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Roles */}
      {skill.roles.length > 0 && (
        <div className="mb-5">
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.5rem',
            }}
          >
            Applies To
          </p>
          <div className="flex flex-wrap gap-1.5">
            {skill.roles.map(r => (
              <span
                key={r}
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.68rem',
                  background: 'rgba(139,92,246,0.08)',
                  color: '#8b5cf6',
                  border: '1px solid rgba(139,92,246,0.25)',
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {skill.body && (
        <div>
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.5rem',
            }}
          >
            Body
          </p>
          <div
            style={{
              background: 'rgba(10,14,23,0.6)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 6,
              padding: '0.875rem 1rem',
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            <pre
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.72rem',
                color: '#c5d0e6',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.55,
              }}
            >
              {skill.body}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SkillsPage() {
  const { data: skills, loading } = useApiQuery<Skill[]>('/api/skills');
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const domains = useMemo(() => {
    if (!skills) return [];
    return [...new Set(skills.map(s => s.domain))].sort();
  }, [skills]);

  const filtered = useMemo(() => {
    if (!skills) return [];
    let list = skills;
    if (domainFilter !== 'all') list = list.filter(s => s.domain === domainFilter);
    if (confidenceFilter !== 'all') list = list.filter(s => s.confidence === confidenceFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q) ||
          s.triggers.some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [skills, search, domainFilter, confidenceFilter]);

  const selectedSkill = useMemo(
    () => skills?.find(s => s.id === selectedId) ?? null,
    [skills, selectedId]
  );

  const effectiveSelected = selectedSkill ?? filtered[0] ?? null;

  // Stats summary
  const stats = useMemo(() => {
    if (!skills) return null;
    const total = skills.length;
    const high = skills.filter(s => s.confidence === 'high').length;
    const medium = skills.filter(s => s.confidence === 'medium').length;
    const low = skills.filter(s => s.confidence === 'low').length;
    const staleCount = skills.filter(s => isStale(s.reviewByDate)).length;
    return { total, high, medium, low, staleCount };
  }, [skills]);

  return (
    <div className="px-6 py-10" style={{ maxWidth: 1140, margin: '0 auto' }}>
      {/* Header */}
      <div className="mb-4 kindle">
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
          Skills Library
        </h1>
      </div>

      {/* Stats bar */}
      {stats && (
        <div
          className="flex items-center gap-5 mb-6 kindle kindle-1"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.7rem',
          }}
        >
          <span style={{ color: '#8899b3' }}>{stats.total} skills</span>
          <span style={{ color: '#22c55e' }}>{stats.high} high</span>
          <span style={{ color: '#e8a838' }}>{stats.medium} medium</span>
          <span style={{ color: '#ef4444' }}>{stats.low} low</span>
          {stats.staleCount > 0 && (
            <span style={{ color: '#ef4444' }}>{stats.staleCount} stale</span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 kindle kindle-1 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search skills..."
          className={[
            'flex-1 min-w-[200px] bg-transparent text-[0.85rem] text-[#c5d0e6]',
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

        {/* Confidence filter */}
        <div className="flex items-center gap-1">
          {(['all', 'high', 'medium', 'low'] as const).map(c => (
            <button
              key={c}
              onClick={() => setConfidenceFilter(c)}
              style={{
                background: confidenceFilter === c ? 'rgba(36,48,68,0.5)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.68rem',
                color:
                  confidenceFilter === c
                    ? c === 'high'
                      ? '#22c55e'
                      : c === 'medium'
                      ? '#e8a838'
                      : c === 'low'
                      ? '#ef4444'
                      : '#c5d0e6'
                    : '#6b7280',
                padding: '0.2rem 0.5rem',
                borderRadius: 4,
              } as React.CSSProperties}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Domain filter chips */}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6 kindle kindle-2">
          <button
            onClick={() => setDomainFilter('all')}
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              background: domainFilter === 'all' ? 'rgba(59,130,246,0.15)' : 'rgba(26,35,54,0.4)',
              color: domainFilter === 'all' ? '#3b82f6' : '#8899b3',
              border: `1px solid ${domainFilter === 'all' ? 'rgba(59,130,246,0.4)' : 'rgba(36,48,68,0.5)'}`,
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            All
          </button>
          {domains.map(d => {
            const color = getDomainColor(d, domains);
            const active = domainFilter === d;
            return (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  fontSize: '0.65rem',
                  background: active ? `${color}20` : 'rgba(26,35,54,0.4)',
                  color: active ? color : '#8899b3',
                  border: `1px solid ${active ? `${color}44` : 'rgba(36,48,68,0.5)'}`,
                  borderRadius: 4,
                  padding: '3px 10px',
                  cursor: 'pointer',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: skill list */}
        <div style={{ width: 300, flexShrink: 0 }}>
          {loading ? (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Loading skills...
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
              No skills found.
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((s, i) => (
                <div
                  key={s.id}
                  className={`kindle kindle-${Math.min(i + 1, 5)}`}
                >
                  <SkillRow
                    skill={s}
                    selected={effectiveSelected?.id === s.id}
                    onSelect={() => setSelectedId(s.id)}
                    domainColor={getDomainColor(s.domain, domains)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0">
          {effectiveSelected ? (
            <SkillDetail
              skill={effectiveSelected}
              domainColor={getDomainColor(effectiveSelected.domain, domains)}
            />
          ) : (
            <div
              className="text-center py-24"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Select a skill to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
