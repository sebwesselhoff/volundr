'use client';

import { useState } from 'react';
import type { Event } from '@vldr/shared';

function getEventColor(type: Event['type']): string {
  switch (type) {
    case 'agent_spawned':
    case 'agent_completed':
    case 'agent_timeout':
      return '#3b82f6'; // Steel Blue — agent events
    case 'quality_scored':
    case 'milestone_reached':
    case 'branch_merged':
    case 'checkpoint_created':
      return '#e8a838'; // Gold — quality/completion
    case 'card_status_changed':
      return '#e8a838'; // Gold — card completion
    case 'error':
    case 'build_gate_failed':
    case 'antipattern_found':
    case 'retry_triggered':
      return '#d4581a'; // Ember — failures
    default:
      return '#60a5fa'; // Ice — info/default
  }
}

function formatTime(ts: string): string {
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface EventRowProps {
  event: Event;
}

export function EventRow({ event }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const color = getEventColor(event.type);

  return (
    <div
      className="kindle border-b border-[rgba(36,48,68,0.5)] cursor-pointer group"
      onClick={() => setExpanded(v => !v)}
    >
      {/* Collapsed row */}
      <div className="flex items-center gap-3 min-w-0 py-2.5 px-1 transition-colors group-hover:bg-[rgba(36,48,68,0.25)]">
        {/* Timestamp */}
        <span
          className="flex-shrink-0 text-[0.75rem] text-[#8899b3]"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            minWidth: '5.5rem',
          }}
        >
          {formatTime(event.timestamp)}
        </span>

        {/* Color dot */}
        <span
          className="flex-shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: color, flexShrink: 0 }}
        />

        {/* Description */}
        <span
          className="flex-1 text-[0.85rem] text-[#c5d0e6] truncate"
          style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
        >
          {event.detail || <span className="text-[#8899b3] italic">no detail</span>}
        </span>

        {/* Card reference */}
        {event.cardId && (
          <span
            className="flex-shrink-0 text-[0.75rem] text-[#8899b3] text-right"
            style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
          >
            {event.cardId}
          </span>
        )}

        {/* Expand indicator */}
        <span
          className="flex-shrink-0 text-[#8899b3] text-[0.7rem] transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ›
        </span>
      </div>

      {/* Expanded panel */}
      <div
        style={{
          maxHeight: expanded ? '16rem' : '0',
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 250ms ease, opacity 200ms ease',
        }}
      >
        <div className="px-4 pb-4 pt-1 space-y-2">
          {/* Full detail */}
          {event.detail && (
            <div>
              <p
                className="text-[0.65rem] uppercase tracking-[0.08em] text-[#8899b3] mb-1"
                style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
              >
                Detail
              </p>
              <p
                className="text-[0.8rem] text-[#c5d0e6] leading-relaxed whitespace-pre-wrap break-words"
                style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
              >
                {event.detail}
              </p>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-4 pt-1">
            {event.cardId && (
              <div>
                <span
                  className="text-[0.65rem] uppercase tracking-[0.08em] text-[#8899b3] mr-1.5"
                  style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
                >
                  Card
                </span>
                <span
                  className="text-[0.75rem] text-[#8899b3]"
                  style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
                >
                  {event.cardId}
                </span>
              </div>
            )}
            {event.costEstimate != null && (
              <div>
                <span
                  className="text-[0.65rem] uppercase tracking-[0.08em] text-[#8899b3] mr-1.5"
                  style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
                >
                  Cost
                </span>
                <span
                  className="text-[0.75rem] text-[#e8a838]"
                  style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
                >
                  ${event.costEstimate.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
