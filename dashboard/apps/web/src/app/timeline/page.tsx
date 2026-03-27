'use client';

import { useState } from 'react';
import type { TimelineEntry } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';

// ─── helpers ────────────────────────────────────────────────────────────────

function getTimestamp(entry: TimelineEntry): string {
  if ('timestamp' in entry) return entry.timestamp;
  if ('startedAt' in entry) return entry.startedAt;
  return '';
}

function formatTs(ts: string): string {
  if (!ts) return '';
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function getEventColor(type: string): string {
  if (type === 'agent_spawned' || type === 'agent_completed') return '#3b82f6';
  if (type === 'card_status_changed') return '#22c55e';
  if (type === 'quality_scored') return '#e8a838';
  if (type === 'error' || type === 'build_gate_failed') return '#ef4444';
  if (type === 'milestone_reached') return '#8b5cf6';
  return '#6b7280';
}

function getKindColor(kind: TimelineEntry['kind']): string {
  switch (kind) {
    case 'agent_lifecycle': return '#3b82f6';
    case 'card_transition': return '#22c55e';
    case 'quality_score': return '#e8a838';
    case 'event': return '#6b7280';
  }
}

function getScoreColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 6) return '#e8a838';
  return '#ef4444';
}

// ─── node components ─────────────────────────────────────────────────────────

interface EventNodeProps {
  entry: Extract<TimelineEntry, { kind: 'event' }>;
  expanded: boolean;
  onToggle: () => void;
  onHighlight?: () => void;
}

function EventNode({ entry, expanded, onToggle, onHighlight }: EventNodeProps) {
  const color = getEventColor(entry.type);
  return (
    <button
      onClick={onToggle}
      className="w-full text-left"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-block rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider shrink-0"
          style={{
            background: `${color}22`,
            color,
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          }}
        >
          {entry.type.replace(/_/g, ' ')}
        </span>
        <span
          className="text-[0.8rem] text-[#c5d0e6] leading-5 truncate"
          style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
        >
          {entry.title !== entry.type ? entry.title : (entry.detail?.slice(0, 60) || '')}
        </span>
      </div>
      {entry.cardId && (
        <p className="mt-1 text-[0.7rem]" style={{ color: '#8899b3' }}>
          card:{' '}
          <span
            onClick={(e) => { e.stopPropagation(); onHighlight?.(); }}
            style={{
              color: '#60a5fa',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {entry.cardId}
          </span>
        </p>
      )}
      {expanded && entry.detail && (
        <p
          className="mt-2 text-[0.75rem] leading-5 whitespace-pre-wrap break-words"
          style={{
            color: '#8899b3',
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            borderLeft: `2px solid ${color}44`,
            paddingLeft: '0.75rem',
          }}
        >
          {entry.detail}
        </p>
      )}
      {entry.costEstimate != null && (
        <p className="mt-1 text-[0.65rem]" style={{ color: '#8899b355' }}>
          cost: ${entry.costEstimate.toFixed(4)}
        </p>
      )}
    </button>
  );
}

interface AgentNodeProps {
  entry: Extract<TimelineEntry, { kind: 'agent_lifecycle' }>;
  onHighlight?: () => void;
}

function AgentNode({ entry, onHighlight }: AgentNodeProps) {
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-[0.8rem] font-semibold"
          style={{
            color: '#3b82f6',
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          }}
        >
          {entry.agentType}
        </span>
        <span className="text-[0.7rem]" style={{ color: '#8899b3' }}>
          {entry.model}
        </span>
        <span
          className="ml-auto text-[0.7rem] tabular-nums"
          style={{ color: '#e8a838' }}
        >
          {formatDuration(entry.durationMs)}
        </span>
      </div>
      {entry.cardId && (
        <p className="mt-1 text-[0.7rem]" style={{ color: '#8899b3' }}>
          card:{' '}
          <span
            onClick={(e) => { e.stopPropagation(); onHighlight?.(); }}
            style={{
              color: '#60a5fa',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {entry.cardId}
          </span>
        </p>
      )}
    </div>
  );
}

interface CardTransitionNodeProps {
  entry: Extract<TimelineEntry, { kind: 'card_transition' }>;
  expanded: boolean;
  onToggle: () => void;
  onHighlight?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  in_progress: '#3b82f6',
  review: '#e8a838',
  done: '#22c55e',
  blocked: '#ef4444',
  cancelled: '#6b7280',
};

function statusColor(s: string): string {
  return STATUS_COLORS[s?.toLowerCase()] ?? '#6b7280';
}

function StatusPill({ label }: { label: string }) {
  const color = statusColor(label);
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider"
      style={{
        background: `${color}22`,
        color,
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
      }}
    >
      {label || '—'}
    </span>
  );
}

function CardTransitionNode({ entry, expanded, onToggle, onHighlight }: CardTransitionNodeProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onHighlight}
        title="Click to highlight all entries for this card"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
        }}
      >
        <span
          className="text-[0.75rem]"
          style={{
            color: '#60a5fa',
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {entry.cardId}
        </span>
        <StatusPill label={entry.fromStatus} />
        <span style={{ color: '#8899b3', fontSize: '0.7rem' }}>→</span>
        <StatusPill label={entry.toStatus} />
      </button>
    </div>
  );
}

interface QualityNodeProps {
  entry: Extract<TimelineEntry, { kind: 'quality_score' }>;
  expanded: boolean;
  onToggle: () => void;
}

function QualityNode({ entry, expanded, onToggle }: QualityNodeProps) {
  const color = getScoreColor(entry.weightedScore);
  return (
    <button
      onClick={onToggle}
      className="w-full text-left"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      <div className="flex items-center gap-3">
        <span
          className="text-[0.75rem]"
          style={{
            color: '#c5d0e6',
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          }}
        >
          {entry.cardId}
        </span>
        <span
          className="text-[1rem] font-bold tabular-nums"
          style={{ color, fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
        >
          {entry.weightedScore.toFixed(1)}
        </span>
        <span className="text-[0.65rem]" style={{ color: '#8899b355' }}>
          / 10
        </span>
      </div>
    </button>
  );
}

// ─── shimmer loader ──────────────────────────────────────────────────────────

function Shimmer() {
  return (
    <div className="relative" style={{ paddingTop: 120 }}>
      {/* center line */}
      <div
        className="absolute top-0 bottom-0 left-1/2 -translate-x-px"
        style={{ width: 2, background: '#243044', zIndex: 0 }}
      />
      <div className="space-y-10 relative z-10">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start pr-[50%]' : 'justify-end pl-[50%]'} relative`}>
            {/* dot */}
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full"
              style={{ width: 12, height: 12, background: '#243044' }}
            />
            <div
              className="w-[44%] rounded-xl animate-pulse"
              style={{
                background: 'rgba(36,48,68,0.4)',
                height: 64,
                margin: i % 2 === 0 ? '0 28px 0 0' : '0 0 0 28px',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const { projectId } = useProject();
  const { data, loading } = useApiQuery<TimelineEntry[]>(
    projectId ? `/api/projects/${projectId}/timeline` : null
  );

  // Set of expanded entry indices (events/card_transitions/quality_scores can expand)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);

  function toggle(idx: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function handleHighlight(cardId: string) {
    setHighlightedCardId(prev => (prev === cardId ? null : cardId));
  }

  function getHighlightState(entry: TimelineEntry): 'highlighted' | 'dimmed' | 'normal' {
    if (!highlightedCardId) return 'normal';
    const entryCardId = 'cardId' in entry ? entry.cardId : undefined;
    if (entryCardId === highlightedCardId) return 'highlighted';
    return 'dimmed';
  }

  const entries = data ?? [];

  if (loading) {
    return (
      <div
        style={{
          paddingTop: 120,
          maxWidth: 900,
          margin: '0 auto',
          padding: '120px 24px 80px',
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        }}
      >
        <Shimmer />
      </div>
    );
  }

  if (!projectId || entries.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: 'calc(100vh - 120px)', paddingTop: 120 }}
      >
        <div className="text-center">
          <p
            style={{
              color: '#8899b3',
              fontSize: '0.85rem',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            }}
          >
            {!projectId ? 'Select a project to view the timeline.' : 'No timeline data'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        paddingTop: 120,
        maxWidth: 960,
        margin: '0 auto',
        padding: '120px 24px 80px',
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
      }}
    >
      {/* Highlight banner */}
      {highlightedCardId && (
        <div
          className="flex items-center justify-between mb-6 rounded-lg px-4 py-2"
          style={{
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.3)',
          }}
        >
          <span className="text-[0.75rem]" style={{ color: '#60a5fa' }}>
            Showing all entries for card:{' '}
            <strong style={{ color: '#93c5fd' }}>{highlightedCardId}</strong>
          </span>
          <button
            onClick={() => setHighlightedCardId(null)}
            className="text-[0.7rem] px-2 py-0.5 rounded"
            style={{
              background: 'rgba(59,130,246,0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.3)',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Timeline container — relative so the center line and dots can be positioned */}
      <div className="relative">
        {/* Center vertical line */}
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-px pointer-events-none"
          style={{ width: 2, background: '#243044', zIndex: 0 }}
        />

        <div className="space-y-8">
          {entries.map((entry, idx) => {
            const isLeft = idx % 2 === 0;
            const ts = getTimestamp(entry);
            const dotColor =
              entry.kind === 'event'
                ? getEventColor(entry.type)
                : getKindColor(entry.kind);
            const entryCardId = 'cardId' in entry ? (entry.cardId ?? undefined) : undefined;
            const highlightState = getHighlightState(entry);

            return (
              <div key={idx} className="relative flex items-start" style={{ zIndex: 1 }}>
                {/* LEFT side card */}
                {isLeft ? (
                  <>
                    <div className="w-[calc(50%-20px)] pr-4 flex justify-end">
                      <NodeCard
                        entry={entry}
                        idx={idx}
                        expanded={expanded.has(idx)}
                        onToggle={() => toggle(idx)}
                        ts={ts}
                        dotColor={dotColor}
                        align="right"
                        highlightState={highlightState}
                        onHighlight={() => entryCardId && handleHighlight(entryCardId)}
                      />
                    </div>
                    {/* dot */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-4 rounded-full border-2"
                      style={{
                        width: 14,
                        height: 14,
                        background: dotColor,
                        borderColor: '#0a0e17',
                        zIndex: 2,
                        boxShadow: `0 0 8px ${dotColor}88`,
                        opacity: highlightState === 'dimmed' ? 0.4 : 1,
                        transition: 'opacity 200ms ease',
                      }}
                    />
                    <div className="w-[calc(50%-20px)] pl-4" />
                  </>
                ) : (
                  <>
                    <div className="w-[calc(50%-20px)] pr-4" />
                    {/* dot */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-4 rounded-full border-2"
                      style={{
                        width: 14,
                        height: 14,
                        background: dotColor,
                        borderColor: '#0a0e17',
                        zIndex: 2,
                        boxShadow: `0 0 8px ${dotColor}88`,
                        opacity: highlightState === 'dimmed' ? 0.4 : 1,
                        transition: 'opacity 200ms ease',
                      }}
                    />
                    <div className="w-[calc(50%-20px)] pl-4 flex justify-start">
                      <NodeCard
                        entry={entry}
                        idx={idx}
                        expanded={expanded.has(idx)}
                        onToggle={() => toggle(idx)}
                        ts={ts}
                        dotColor={dotColor}
                        align="left"
                        highlightState={highlightState}
                        onHighlight={() => entryCardId && handleHighlight(entryCardId)}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── shared card shell ───────────────────────────────────────────────────────

interface NodeCardProps {
  entry: TimelineEntry;
  idx: number;
  expanded: boolean;
  onToggle: () => void;
  ts: string;
  dotColor: string;
  align: 'left' | 'right';
  highlightState: 'highlighted' | 'dimmed' | 'normal';
  onHighlight: () => void;
}

function getEntryCardId(entry: TimelineEntry): string | undefined {
  if ('cardId' in entry) return entry.cardId ?? undefined;
  return undefined;
}

function NodeCard({ entry, idx, expanded, onToggle, ts, dotColor, align, highlightState, onHighlight }: NodeCardProps) {
  const entryCardId = getEntryCardId(entry);
  const cardHighlight = entryCardId ? onHighlight : undefined;

  const isHighlighted = highlightState === 'highlighted';
  const isDimmed = highlightState === 'dimmed';

  return (
    <div
      className="rounded-xl w-full"
      style={{
        background: isHighlighted ? 'rgba(20,30,50,0.85)' : 'rgba(10,14,23,0.6)',
        backdropFilter: 'blur(8px)',
        boxShadow: isHighlighted
          ? `0 2px 20px rgba(0,0,0,0.6), 0 0 0 1px ${dotColor}44`
          : '0 2px 16px rgba(0,0,0,0.4)',
        padding: '12px 16px',
        borderLeft: align === 'left' ? `3px solid ${isHighlighted ? dotColor : dotColor + '55'}` : undefined,
        borderRight: align === 'right' ? `3px solid ${isHighlighted ? dotColor : dotColor + '55'}` : undefined,
        opacity: isDimmed ? 0.4 : 1,
        transition: 'opacity 200ms ease, border-color 200ms ease, background 200ms ease, box-shadow 200ms ease',
        pointerEvents: 'auto',
      }}
    >
      {/* timestamp */}
      <p
        className="text-[0.65rem] mb-2 tabular-nums"
        style={{ color: '#8899b355', textAlign: align }}
      >
        {formatTs(ts)}
      </p>

      {/* content by kind */}
      {entry.kind === 'event' && (
        <EventNode entry={entry} expanded={expanded} onToggle={onToggle} onHighlight={cardHighlight} />
      )}
      {entry.kind === 'agent_lifecycle' && (
        <AgentNode entry={entry} onHighlight={cardHighlight} />
      )}
      {entry.kind === 'card_transition' && (
        <CardTransitionNode entry={entry} expanded={expanded} onToggle={onToggle} onHighlight={cardHighlight} />
      )}
      {entry.kind === 'quality_score' && (
        <QualityNode entry={entry} expanded={expanded} onToggle={onToggle} />
      )}
    </div>
  );
}
