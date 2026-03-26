'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { RoutingRule } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';

// Extended with optional stats fields that may come from the API
type RoutingRuleWithStats = RoutingRule & {
  hitCount?: number;
  accuracy?: number;
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#22c55e',
  medium: '#e8a838',
  low: '#ef4444',
};

// Animated accuracy bar
function AccuracyBar({ pct, color }: { pct: number; color: string }) {
  const [width, setWidth] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      requestAnimationFrame(() => setWidth(pct));
    }
  }, [pct]);
  return (
    <div style={{ height: 4, background: '#1a2336', borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 600ms cubic-bezier(0.4,0,0.2,1)',
        }}
      />
    </div>
  );
}

// Hit counter badge
function HitBadge({ hits }: { hits: number }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.6rem',
        background: hits > 0 ? 'rgba(59,130,246,0.12)' : 'rgba(36,48,68,0.4)',
        color: hits > 0 ? '#3b82f6' : '#6b7280',
        border: `1px solid ${hits > 0 ? 'rgba(59,130,246,0.3)' : 'rgba(36,48,68,0.5)'}`,
        borderRadius: 3,
        padding: '1px 6px',
      }}
    >
      {hits} hit{hits !== 1 ? 's' : ''}
    </span>
  );
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

interface TestResult {
  description: string;
  modulePath: string | null;
  conjunctive: boolean;
  matched: Array<{
    rule: RoutingRule;
    score: number;
    matchedOn: string[];
  }>;
}

function RuleCard({
  rule,
  selected,
  onSelect,
}: {
  rule: RoutingRuleWithStats;
  selected: boolean;
  onSelect: () => void;
}) {
  const confColor = CONFIDENCE_COLORS[rule.confidence] ?? '#8899b3';
  const examples: string[] = (() => {
    try {
      return rule.examples ? JSON.parse(rule.examples as unknown as string) : [];
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
        padding: '0.875rem 1rem',
        cursor: 'pointer',
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <span
          className="truncate font-medium"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.875rem',
            color: '#c5d0e6',
          }}
        >
          {rule.workType}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[0.6rem] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              background: `${confColor}18`,
              color: confColor,
              border: `1px solid ${confColor}33`,
            }}
          >
            {rule.confidence}
          </span>
          <span
            className="text-[0.6rem]"
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              color: '#6b7280',
            }}
          >
            p{rule.priority}
          </span>
        </div>
      </div>

      {/* Persona + hit badge */}
      <div
        className="flex items-center justify-between gap-2"
        style={{
          marginBottom: examples.length > 0 ? '0.5rem' : '0.5rem',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.68rem',
            color: '#8899b3',
          }}
        >
          {rule.personaId}
          {rule.modulePattern && (
            <span style={{ color: '#6b7280' }}> · {rule.modulePattern}</span>
          )}
        </div>
        <HitBadge hits={rule.hitCount ?? 0} />
      </div>

      {/* Accuracy bar */}
      {(rule.accuracy ?? 0) > 0 && (
        <div className="mb-2">
          <AccuracyBar
            pct={Math.round((rule.accuracy ?? 0) * 100)}
            color={confColor}
          />
        </div>
      )}

      {/* Example tags */}
      {examples.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {examples.slice(0, 3).map(ex => (
            <span
              key={ex}
              className="text-[0.6rem] px-1.5 py-0.5 rounded"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                background: 'rgba(36,48,68,0.6)',
                color: '#8899b3',
                border: '1px solid rgba(36,48,68,0.8)',
              }}
            >
              {ex}
            </span>
          ))}
          {examples.length > 3 && (
            <span
              className="text-[0.6rem] px-1.5 py-0.5"
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                color: '#6b7280',
              }}
            >
              +{examples.length - 3}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function RuleDetail({ rule }: { rule: RoutingRuleWithStats }) {
  const confColor = CONFIDENCE_COLORS[rule.confidence] ?? '#8899b3';
  const examples: string[] = (() => {
    try {
      return rule.examples ? JSON.parse(rule.examples as unknown as string) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="kindle kindle-1">
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1">
          <h2
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '1.05rem',
              fontWeight: 600,
              color: '#e8ecf4',
              margin: 0,
            }}
          >
            {rule.workType}
          </h2>
          <span
            className="text-[0.68rem] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              background: `${confColor}18`,
              color: confColor,
              border: `1px solid ${confColor}33`,
            }}
          >
            {rule.confidence}
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
          #{rule.id} · priority {rule.priority} · {formatDate(rule.createdAt)}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: 'Persona', value: rule.personaId },
          { label: 'Status', value: rule.isActive ? 'Active' : 'Inactive' },
          { label: 'Module Pattern', value: rule.modulePattern ?? '—' },
          { label: 'Updated', value: rule.updatedAt ? formatDate(rule.updatedAt) : '—' },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 6,
              padding: '0.625rem 0.875rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.62rem',
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
                fontSize: '0.82rem',
                color: '#c5d0e6',
                margin: 0,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Accuracy stats */}
      <div
        className="mb-5"
        style={{
          background: 'rgba(26,35,54,0.4)',
          border: '1px solid rgba(36,48,68,0.5)',
          borderRadius: 6,
          padding: '0.75rem 0.875rem',
        }}
      >
        <div
          className="flex items-center justify-between mb-2"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.65rem',
            color: '#8899b3',
          }}
        >
          <span>Accuracy</span>
          <div className="flex items-center gap-3">
            <HitBadge hits={rule.hitCount ?? 0} />
            <span style={{ color: confColor }}>
              {rule.accuracy != null ? `${Math.round(rule.accuracy * 100)}%` : '—'}
            </span>
          </div>
        </div>
        <AccuracyBar
          pct={rule.accuracy != null ? Math.round(rule.accuracy * 100) : 0}
          color={confColor}
        />
        {rule.accuracy != null && (
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.6rem',
              color: '#6b7280',
              margin: '0.5rem 0 0',
            }}
          >
            {rule.hitCount ?? 0} total matches · {Math.round((rule.accuracy ?? 0) * 100)}% accepted
          </p>
        )}
      </div>

      {/* Examples */}
      {examples.length > 0 && (
        <div>
          <p
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.62rem',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 0.625rem',
            }}
          >
            Examples
          </p>
          <div className="flex flex-wrap gap-1.5">
            {examples.map(ex => (
              <span
                key={ex}
                className="text-[0.72rem] px-2 py-0.5 rounded"
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  background: 'rgba(59,130,246,0.08)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.25)',
                }}
              >
                {ex}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TestPanel() {
  const [description, setDescription] = useState('');
  const [modulePath, setModulePath] = useState('');
  const [conjunctive, setConjunctive] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { description: description.trim(), conjunctive };
      if (modulePath.trim()) body.modulePath = modulePath.trim();
      const data = await apiFetch<TestResult>('/routing-rules/test', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
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
        Route Test Interface
      </p>

      <div className="space-y-4 mb-5">
        {/* Description input */}
        <div>
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#8899b3',
              marginBottom: '0.4rem',
            }}
          >
            Task Description
          </label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runTest()}
            placeholder="e.g. implement auth middleware..."
            className="w-full bg-[rgba(10,14,23,0.5)] border border-[rgba(36,48,68,0.6)] rounded px-3 py-2 text-[0.8rem] text-[#c5d0e6] placeholder:text-[#8899b3] focus:outline-none focus:border-[#3b82f6]"
            style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
          />
        </div>

        {/* Module path input */}
        <div>
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#8899b3',
              marginBottom: '0.4rem',
            }}
          >
            Module Path (optional)
          </label>
          <input
            type="text"
            value={modulePath}
            onChange={e => setModulePath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runTest()}
            placeholder="e.g. src/api/auth/**"
            className="w-full bg-[rgba(10,14,23,0.5)] border border-[rgba(36,48,68,0.6)] rounded px-3 py-2 text-[0.8rem] text-[#c5d0e6] placeholder:text-[#8899b3] focus:outline-none focus:border-[#3b82f6]"
            style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
          />
        </div>

        {/* Conjunctive toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConjunctive(c => !c)}
            style={{
              width: 36,
              height: 20,
              borderRadius: 10,
              background: conjunctive ? '#3b82f6' : 'rgba(36,48,68,0.6)',
              border: 'none',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: conjunctive ? 18 : 2,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#e8ecf4',
                transition: 'left 0.2s',
              }}
            />
          </button>
          <span
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.72rem',
              color: '#8899b3',
            }}
          >
            Conjunctive matching (all conditions must match)
          </span>
        </div>
      </div>

      <button
        onClick={runTest}
        disabled={!description.trim() || loading}
        style={{
          background: description.trim() && !loading ? '#3b82f6' : 'rgba(59,130,246,0.3)',
          border: 'none',
          borderRadius: 6,
          padding: '0.5rem 1.25rem',
          color: '#e8ecf4',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          cursor: description.trim() && !loading ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s',
        }}
      >
        {loading ? 'Testing...' : 'Run Test'}
      </button>

      {error && (
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.72rem',
            color: '#ef4444',
            margin: '1rem 0 0',
          }}
        >
          {error}
        </p>
      )}

      {/* Results */}
      {result && (
        <div style={{ marginTop: '1.5rem' }}>
          <div
            className="flex items-center justify-between mb-3"
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#6b7280',
            }}
          >
            <span>
              {result.matched.length} match{result.matched.length !== 1 ? 'es' : ''} ·{' '}
              {result.conjunctive ? 'conjunctive' : 'disjunctive'}
            </span>
          </div>

          {result.matched.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontSize: '0.8rem',
                color: '#8899b3',
                textAlign: 'center',
                padding: '1rem 0',
              }}
            >
              No rules matched.
            </p>
          ) : (
            <div className="space-y-2">
              {result.matched.map((m, i) => {
                const confColor = CONFIDENCE_COLORS[m.rule.confidence] ?? '#8899b3';
                return (
                  <div
                    key={m.rule.id}
                    style={{
                      background:
                        i === 0 ? 'rgba(59,130,246,0.06)' : 'rgba(26,35,54,0.3)',
                      border: `1px solid ${i === 0 ? 'rgba(59,130,246,0.25)' : 'rgba(36,48,68,0.4)'}`,
                      borderRadius: 6,
                      padding: '0.625rem 0.875rem',
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {i === 0 && (
                          <span
                            style={{
                              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                              fontSize: '0.6rem',
                              color: '#e8a838',
                              background: 'rgba(232,168,56,0.12)',
                              border: '1px solid rgba(232,168,56,0.25)',
                              borderRadius: 3,
                              padding: '1px 5px',
                            }}
                          >
                            best
                          </span>
                        )}
                        <span
                          style={{
                            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                            fontSize: '0.82rem',
                            color: '#c5d0e6',
                            fontWeight: 500,
                          }}
                        >
                          {m.rule.workType}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          style={{
                            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                            fontSize: '0.68rem',
                            color: '#e8a838',
                          }}
                        >
                          score {m.score}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                            fontSize: '0.6rem',
                            color: confColor,
                            background: `${confColor}18`,
                            border: `1px solid ${confColor}33`,
                            borderRadius: 3,
                            padding: '1px 5px',
                          }}
                        >
                          {m.rule.confidence}
                        </span>
                      </div>
                    </div>

                    <p
                      style={{
                        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                        fontSize: '0.65rem',
                        color: '#8899b3',
                        margin: '0 0 0.375rem',
                      }}
                    >
                      {m.rule.personaId}
                    </p>

                    {/* Matched-on tags */}
                    <div className="flex flex-wrap gap-1">
                      {m.matchedOn.map(tag => (
                        <span
                          key={tag}
                          style={{
                            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                            fontSize: '0.6rem',
                            background: 'rgba(34,197,94,0.08)',
                            color: '#22c55e',
                            border: '1px solid rgba(34,197,94,0.2)',
                            borderRadius: 3,
                            padding: '1px 5px',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RoutingPage() {
  const { data: rules, loading } = useApiQuery<RoutingRuleWithStats[]>('/routing-rules');
  const [search, setSearch] = useState('');
  const [confFilter, setConfFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!rules) return [] as RoutingRuleWithStats[];
    let list = rules;
    if (confFilter !== 'all') {
      list = list.filter(r => r.confidence === confFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        r =>
          r.workType.toLowerCase().includes(q) ||
          r.personaId.toLowerCase().includes(q) ||
          (r.modulePattern ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rules, search, confFilter]);

  const selectedRule = useMemo(
    () => rules?.find(r => r.id === selectedId) ?? null,
    [rules, selectedId]
  ) as RoutingRuleWithStats | null;

  const firstFiltered = filtered[0];
  const effectiveSelected = selectedRule ?? firstFiltered ?? null;

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
          Routing
        </h1>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-4 mb-6 kindle kindle-1">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rules..."
          className={[
            'flex-1 bg-transparent text-[0.85rem] text-[#c5d0e6]',
            'border-0 border-b border-[#243044]',
            'focus:border-[#3b82f6] focus:outline-none',
            'placeholder:text-[#8899b3]',
            'pb-2 transition-colors duration-200',
            '[box-shadow:none]',
            'focus:[box-shadow:0_1px_0_0_#3b82f640]',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
        />

        {(['all', 'high', 'medium', 'low'] as const).map(c => (
          <button
            key={c}
            onClick={() => setConfFilter(c)}
            style={{
              background: confFilter === c ? 'rgba(36,48,68,0.5)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.7rem',
              color:
                confFilter === c
                  ? c === 'high'
                    ? '#22c55e'
                    : c === 'medium'
                    ? '#e8a838'
                    : c === 'low'
                    ? '#ef4444'
                    : '#c5d0e6'
                  : '#6b7280',
              padding: '0.25rem 0.5rem',
              borderRadius: 4,
            } as React.CSSProperties}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Three-column layout: list | detail | test */}
      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: rule list */}
        <div style={{ width: 280, flexShrink: 0 }}>
          {loading ? (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Loading rules...
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
              No rules found.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((r, i) => (
                <div key={r.id} className={`kindle kindle-${Math.min(i + 1, 5)}`}>
                  <RuleCard
                    rule={r}
                    selected={effectiveSelected?.id === r.id}
                    onSelect={() => setSelectedId(r.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Middle: detail panel */}
        <div style={{ width: 280, flexShrink: 0 }}>
          {effectiveSelected ? (
            <RuleDetail rule={effectiveSelected} />
          ) : (
            <div
              className="text-center py-24"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Select a rule to view details.
            </div>
          )}
        </div>

        {/* Right: test interface */}
        <div className="flex-1 min-w-0 kindle kindle-2">
          <TestPanel />
        </div>
      </div>
    </div>
  );
}
