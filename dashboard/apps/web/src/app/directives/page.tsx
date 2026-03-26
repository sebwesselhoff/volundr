'use client';

import { useState, useMemo } from 'react';
import type { Directive } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';
import { apiFetch } from '@/lib/api-client';

const SOURCE_COLORS: Record<string, string> = {
  confirmed: '#22c55e',
  manual: '#3b82f6',
  imported: '#8b5cf6',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  suppressed: '#8899b3',
  superseded: '#6b7280',
};

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

function DirectiveCard({
  directive,
  selected,
  onSelect,
}: {
  directive: Directive;
  selected: boolean;
  onSelect: () => void;
}) {
  const sourceColor = SOURCE_COLORS[directive.source] ?? '#8899b3';
  const statusColor = STATUS_COLORS[directive.status] ?? '#8899b3';
  const isActive = directive.status === 'active';

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
        opacity: isActive ? 1 : 0.7,
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 inline-block rounded-full"
            style={{ width: 7, height: 7, background: statusColor, marginTop: 3 }}
          />
          <span
            className="truncate"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontSize: '0.82rem',
              color: '#c5d0e6',
              lineHeight: 1.45,
            }}
          >
            {directive.content.length > 80
              ? directive.content.slice(0, 80) + '...'
              : directive.content}
          </span>
        </div>
      </div>

      {/* Meta row */}
      <div
        className="flex items-center gap-3"
        style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.62rem',
          color: '#6b7280',
        }}
      >
        <span style={{ color: sourceColor }}>{directive.source}</span>
        <span>p{directive.priority}</span>
        <span>#{directive.id}</span>
        {!isActive && <span style={{ color: statusColor }}>{directive.status}</span>}
      </div>
    </button>
  );
}

function DirectiveDetail({
  directive,
  onStatusChange,
  onDelete,
}: {
  directive: Directive;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const sourceColor = SOURCE_COLORS[directive.source] ?? '#8899b3';
  const statusColor = STATUS_COLORS[directive.status] ?? '#8899b3';

  return (
    <div className="kindle kindle-1">
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="inline-block rounded-full shrink-0"
            style={{ width: 8, height: 8, background: statusColor }}
          />
          <span
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#8899b3',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {directive.status}
          </span>
        </div>
        <p
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.92rem',
            color: '#e8ecf4',
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {directive.content}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: 'Source', value: directive.source },
          { label: 'Priority', value: String(directive.priority) },
          { label: 'Created', value: formatDate(directive.createdAt) },
          {
            label: 'Updated',
            value: directive.updatedAt ? formatDate(directive.updatedAt) : '—',
          },
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
                color:
                  label === 'Source'
                    ? sourceColor
                    : '#c5d0e6',
                margin: 0,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {directive.supersededBy != null && (
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.7rem',
            color: '#6b7280',
            margin: '0 0 1.25rem',
          }}
        >
          Superseded by #{directive.supersededBy}
        </p>
      )}

      {/* Actions */}
      {directive.status === 'active' && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onStatusChange(directive.id, 'suppressed')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(136,153,179,0.3)',
              borderRadius: 5,
              padding: '0.4rem 0.875rem',
              color: '#8899b3',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
          >
            Suppress
          </button>
          <button
            onClick={() => onStatusChange(directive.id, 'superseded')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(107,114,128,0.3)',
              borderRadius: 5,
              padding: '0.4rem 0.875rem',
              color: '#6b7280',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
          >
            Supersede
          </button>
          <button
            onClick={() => onDelete(directive.id)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 5,
              padding: '0.4rem 0.875rem',
              color: '#ef4444',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            Delete
          </button>
        </div>
      )}
      {directive.status !== 'active' && (
        <button
          onClick={() => onStatusChange(directive.id, 'active')}
          style={{
            background: 'transparent',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 5,
            padding: '0.4rem 0.875rem',
            color: '#22c55e',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            cursor: 'pointer',
          }}
        >
          Restore
        </button>
      )}
    </div>
  );
}

function CreateDirectiveForm({
  projectId,
  onCreated,
}: {
  projectId: string | null;
  onCreated: () => void;
}) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState<'manual' | 'confirmed' | 'imported'>('manual');
  const [priority, setPriority] = useState('0');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!content.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        scope === 'project' && projectId
          ? `/api/projects/${projectId}/directives`
          : '/api/directives';
      await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          content: content.trim(),
          source,
          priority: parseInt(priority, 10) || 0,
        }),
      });
      setContent('');
      setPriority('0');
      onCreated();
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
        New Directive
      </p>

      <div className="space-y-4 mb-5">
        {/* Content */}
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
            Content
          </label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={3}
            placeholder="Enter directive text..."
            className="w-full bg-[rgba(10,14,23,0.5)] border border-[rgba(36,48,68,0.6)] rounded px-3 py-2 text-[0.8rem] text-[#c5d0e6] placeholder:text-[#8899b3] focus:outline-none focus:border-[#3b82f6] resize-none"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
          />
        </div>

        {/* Source + Priority row */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.65rem',
                color: '#8899b3',
                marginBottom: '0.4rem',
              }}
            >
              Source
            </label>
            <select
              value={source}
              onChange={e => setSource(e.target.value as typeof source)}
              className="w-full bg-[rgba(10,14,23,0.5)] border border-[rgba(36,48,68,0.6)] rounded px-3 py-2 text-[0.8rem] text-[#c5d0e6] focus:outline-none focus:border-[#3b82f6]"
              style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
            >
              <option value="manual">manual</option>
              <option value="confirmed">confirmed</option>
              <option value="imported">imported</option>
            </select>
          </div>

          <div style={{ width: 80 }}>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.65rem',
                color: '#8899b3',
                marginBottom: '0.4rem',
              }}
            >
              Priority
            </label>
            <input
              type="number"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              min={0}
              max={100}
              className="w-full bg-[rgba(10,14,23,0.5)] border border-[rgba(36,48,68,0.6)] rounded px-3 py-2 text-[0.8rem] text-[#c5d0e6] focus:outline-none focus:border-[#3b82f6]"
              style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
            />
          </div>
        </div>

        {/* Scope toggle */}
        {projectId && (
          <div className="flex gap-2">
            {(['global', 'project'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  background: scope === s ? 'rgba(59,130,246,0.15)' : 'transparent',
                  border: `1px solid ${scope === s ? 'rgba(59,130,246,0.4)' : 'rgba(36,48,68,0.5)'}`,
                  borderRadius: 5,
                  padding: '0.3rem 0.75rem',
                  color: scope === s ? '#3b82f6' : '#8899b3',
                  fontSize: '0.7rem',
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.72rem',
            color: '#ef4444',
            margin: '0 0 0.875rem',
          }}
        >
          {error}
        </p>
      )}

      <button
        onClick={handleCreate}
        disabled={!content.trim() || loading}
        style={{
          background: content.trim() && !loading ? '#3b82f6' : 'rgba(59,130,246,0.3)',
          border: 'none',
          borderRadius: 6,
          padding: '0.5rem 1.25rem',
          color: '#e8ecf4',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          cursor: content.trim() && !loading ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s',
        }}
      >
        {loading ? 'Creating...' : 'Create Directive'}
      </button>
    </div>
  );
}

export default function DirectivesPage() {
  const { projectId } = useProject();

  const { data: globalDirectives, loading: globalLoading, refetch: refetchGlobal } =
    useApiQuery<Directive[]>('/api/directives');

  const { data: projectDirectives, loading: projectLoading, refetch: refetchProject } =
    useApiQuery<Directive[]>(
      projectId ? `/api/projects/${projectId}/directives` : null
    );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<'global' | 'project'>('global');

  const directives = tab === 'global' ? (globalDirectives ?? []) : (projectDirectives ?? []);
  const loading = tab === 'global' ? globalLoading : projectLoading;
  const refetch = tab === 'global' ? refetchGlobal : refetchProject;

  const filtered = useMemo(() => {
    let list = directives;
    if (statusFilter !== 'all') {
      list = list.filter(d => d.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(d => d.content.toLowerCase().includes(q));
    }
    return list;
  }, [directives, search, statusFilter]);

  const selectedDirective = useMemo(
    () => directives.find(d => d.id === selectedId) ?? null,
    [directives, selectedId]
  );

  const firstFiltered = filtered[0];
  const effectiveSelected = selectedDirective ?? firstFiltered ?? null;

  async function handleStatusChange(id: number, status: string) {
    try {
      await apiFetch(`/api/directives/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      refetch();
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiFetch(`/api/directives/${id}`, { method: 'DELETE' });
      if (selectedId === id) setSelectedId(null);
      refetch();
    } catch {
      // ignore
    }
  }

  // Stats
  const activeCount = directives.filter(d => d.status === 'active').length;
  const suppressedCount = directives.filter(d => d.status === 'suppressed').length;
  const supersededCount = directives.filter(d => d.status === 'superseded').length;

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
          Directives
        </h1>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-6 kindle kindle-1">
        {[
          { label: 'Active', value: activeCount, color: '#22c55e' },
          { label: 'Suppressed', value: suppressedCount, color: '#8899b3' },
          { label: 'Superseded', value: supersededCount, color: '#6b7280' },
          { label: 'Total', value: directives.length, color: '#c5d0e6' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: 'rgba(26,35,54,0.4)',
              border: '1px solid rgba(36,48,68,0.5)',
              borderRadius: 6,
              padding: '0.625rem 1rem',
              minWidth: 80,
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                fontSize: '0.6rem',
                color: '#6b7280',
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
                fontSize: '1.1rem',
                color,
                margin: 0,
                fontWeight: 600,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Tab + filters */}
      <div className="flex items-center gap-4 mb-6 kindle kindle-2">
        {/* Global / Project tabs */}
        <div
          className="flex gap-4"
          style={{ borderBottom: '1px solid rgba(36,48,68,0.5)', paddingBottom: 0 }}
        >
          {(['global', 'project'] as const).map(t => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="focus:outline-none"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 0 0.6rem',
                  position: 'relative',
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontSize: '0.78rem',
                  color: active ? '#c5d0e6' : '#8899b3',
                  transition: 'color 0.15s',
                }}
              >
                {t === 'global' ? 'Global' : 'Project'}
                {active && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -1,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: '#3b82f6',
                      borderRadius: 1,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search directives..."
          className={[
            'flex-1 bg-transparent text-[0.85rem] text-[#c5d0e6]',
            'border-0 border-b border-[#243044]',
            'focus:border-[#3b82f6] focus:outline-none',
            'placeholder:text-[#8899b3]',
            'pb-2 transition-colors duration-200',
            '[box-shadow:none]',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
        />

        {/* Status filter */}
        {(['all', 'active', 'suppressed', 'superseded'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              background: statusFilter === s ? 'rgba(36,48,68,0.5)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontSize: '0.7rem',
              color:
                statusFilter === s
                  ? s === 'active'
                    ? '#22c55e'
                    : s === 'suppressed'
                    ? '#8899b3'
                    : s === 'superseded'
                    ? '#6b7280'
                    : '#c5d0e6'
                  : '#6b7280',
              padding: '0.25rem 0.5rem',
              borderRadius: 4,
            } as React.CSSProperties}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: directive list */}
        <div style={{ width: 380, flexShrink: 0 }}>
          {loading ? (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Loading directives...
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
              No directives found.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((d, i) => (
                <div key={d.id} className={`kindle kindle-${Math.min(i + 1, 5)}`}>
                  <DirectiveCard
                    directive={d}
                    selected={effectiveSelected?.id === d.id}
                    onSelect={() => setSelectedId(d.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail + create */}
        <div className="flex-1 min-w-0 space-y-5">
          {effectiveSelected ? (
            <DirectiveDetail
              directive={effectiveSelected}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ) : (
            <div
              className="text-center py-12"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                color: '#8899b3',
                fontSize: '0.85rem',
              }}
            >
              Select a directive to view details.
            </div>
          )}

          <CreateDirectiveForm
            projectId={projectId ?? null}
            onCreated={() => {
              refetch();
            }}
          />
        </div>
      </div>
    </div>
  );
}
