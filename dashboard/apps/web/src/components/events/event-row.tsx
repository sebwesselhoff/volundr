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
    case 'build_gate_passed':
      return '#22c55e'; // Green — success
    case 'session_started':
    case 'session_ended':
    case 'shutdown_started':
      return '#8b5cf6'; // Purple — session
    default:
      return '#60a5fa'; // Ice — info/default
  }
}

// SVG icon representing each event type (12x12 viewport)
function EventIcon({ type, color }: { type: Event['type']; color: string }) {
  const s = 12;
  const c = color;

  let icon: React.ReactNode;
  switch (type) {
    case 'agent_spawned':
      // Plus / spawn symbol
      icon = (
        <>
          <circle cx={6} cy={6} r={5} fill="none" stroke={c} strokeWidth={1.2} />
          <line x1={6} y1={3} x2={6} y2={9} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <line x1={3} y1={6} x2={9} y2={6} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
        </>
      );
      break;
    case 'agent_completed':
      // Check mark in circle
      icon = (
        <>
          <circle cx={6} cy={6} r={5} fill="none" stroke={c} strokeWidth={1.2} />
          <polyline points="3.5,6 5.5,8 8.5,4" fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case 'agent_timeout':
      // Clock
      icon = (
        <>
          <circle cx={6} cy={6} r={5} fill="none" stroke={c} strokeWidth={1.2} />
          <line x1={6} y1={3.5} x2={6} y2={6} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <line x1={6} y1={6} x2={8} y2={7.5} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
        </>
      );
      break;
    case 'card_status_changed':
      // Card / rectangle
      icon = (
        <>
          <rect x={2} y={2.5} width={8} height={7} rx={1} fill="none" stroke={c} strokeWidth={1.2} />
          <line x1={4} y1={5} x2={8} y2={5} stroke={c} strokeWidth={1} strokeLinecap="round" />
          <line x1={4} y1={7} x2={7} y2={7} stroke={c} strokeWidth={1} strokeLinecap="round" />
        </>
      );
      break;
    case 'quality_scored':
      // Star
      icon = (
        <polygon
          points="6,1.5 7.2,4.6 10.4,4.6 7.9,6.6 8.8,9.7 6,7.9 3.2,9.7 4.1,6.6 1.6,4.6 4.8,4.6"
          fill="none"
          stroke={c}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      );
      break;
    case 'build_gate_passed':
      // Shield with check
      icon = (
        <>
          <path d="M6 1.5 L10 3 L10 6.5 C10 8.5 8 10 6 10.5 C4 10 2 8.5 2 6.5 L2 3 Z" fill="none" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
          <polyline points="4,6 5.5,7.5 8,4.5" fill="none" stroke={c} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case 'build_gate_failed':
      // Shield with X
      icon = (
        <>
          <path d="M6 1.5 L10 3 L10 6.5 C10 8.5 8 10 6 10.5 C4 10 2 8.5 2 6.5 L2 3 Z" fill="none" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
          <line x1={4.5} y1={4.5} x2={7.5} y2={7.5} stroke={c} strokeWidth={1.1} strokeLinecap="round" />
          <line x1={7.5} y1={4.5} x2={4.5} y2={7.5} stroke={c} strokeWidth={1.1} strokeLinecap="round" />
        </>
      );
      break;
    case 'error':
    case 'antipattern_found':
      // Warning triangle
      icon = (
        <>
          <path d="M6 2 L10.5 9.5 L1.5 9.5 Z" fill="none" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
          <line x1={6} y1={5} x2={6} y2={7.5} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <circle cx={6} cy={8.5} r={0.6} fill={c} />
        </>
      );
      break;
    case 'retry_triggered':
      // Refresh arrows
      icon = (
        <>
          <path d="M9 4 A3.5 3.5 0 1 0 9.5 7" fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <polyline points="9,2 9,4 11,4" fill="none" stroke={c} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case 'branch_merged':
      // Git merge icon
      icon = (
        <>
          <circle cx={4} cy={3} r={1.5} fill="none" stroke={c} strokeWidth={1.1} />
          <circle cx={4} cy={9} r={1.5} fill="none" stroke={c} strokeWidth={1.1} />
          <circle cx={8.5} cy={6} r={1.5} fill="none" stroke={c} strokeWidth={1.1} />
          <path d="M4 4.5 C4 6 7 6 7 6" fill="none" stroke={c} strokeWidth={1.1} strokeLinecap="round" />
          <path d="M4 7.5 C4 6 7 6 7 6" fill="none" stroke={c} strokeWidth={1.1} strokeLinecap="round" />
        </>
      );
      break;
    case 'milestone_reached':
      // Flag
      icon = (
        <>
          <line x1={3} y1={2} x2={3} y2={10} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <path d="M3 2 L9 4 L3 6" fill={`${c}30`} stroke={c} strokeWidth={1.1} strokeLinejoin="round" />
        </>
      );
      break;
    case 'checkpoint_created':
      // Bookmark
      icon = (
        <path d="M3 2 L9 2 L9 10 L6 8 L3 10 Z" fill="none" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
      );
      break;
    case 'session_started':
      // Power button
      icon = (
        <>
          <path d="M4.5 3 A4 4 0 1 0 7.5 3" fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <line x1={6} y1={2} x2={6} y2={6} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
        </>
      );
      break;
    case 'session_ended':
    case 'shutdown_started':
      // Power button dim
      icon = (
        <>
          <path d="M4.5 3 A4 4 0 1 0 7.5 3" fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeDasharray="1.5 1" />
          <line x1={6} y1={2} x2={6} y2={6} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
        </>
      );
      break;
    case 'hierarchy_assessed':
      // Tree / hierarchy
      icon = (
        <>
          <circle cx={6} cy={3} r={1.3} fill="none" stroke={c} strokeWidth={1.1} />
          <circle cx={3} cy={9} r={1.3} fill="none" stroke={c} strokeWidth={1.1} />
          <circle cx={9} cy={9} r={1.3} fill="none" stroke={c} strokeWidth={1.1} />
          <line x1={6} y1={4.3} x2={6} y2={6.5} stroke={c} strokeWidth={1} strokeLinecap="round" />
          <line x1={6} y1={6.5} x2={3} y2={7.7} stroke={c} strokeWidth={1} strokeLinecap="round" />
          <line x1={6} y1={6.5} x2={9} y2={7.7} stroke={c} strokeWidth={1} strokeLinecap="round" />
        </>
      );
      break;
    default:
      // Default: info circle
      icon = (
        <>
          <circle cx={6} cy={6} r={5} fill="none" stroke={c} strokeWidth={1.2} />
          <line x1={6} y1={5} x2={6} y2={8.5} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
          <circle cx={6} cy={3.5} r={0.7} fill={c} />
        </>
      );
  }

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ flexShrink: 0 }}
    >
      {icon}
    </svg>
  );
}

// Human-readable label for each event type
function getEventLabel(type: Event['type']): string {
  switch (type) {
    case 'agent_spawned': return 'Agent Spawned';
    case 'agent_completed': return 'Agent Completed';
    case 'agent_timeout': return 'Agent Timeout';
    case 'card_status_changed': return 'Card Updated';
    case 'quality_scored': return 'Quality Scored';
    case 'retry_triggered': return 'Retry';
    case 'branch_merged': return 'Branch Merged';
    case 'optimization_cycle': return 'Optimization';
    case 'milestone_reached': return 'Milestone';
    case 'intervention': return 'Intervention';
    case 'checkpoint_created': return 'Checkpoint';
    case 'error': return 'Error';
    case 'build_gate_failed': return 'Build Failed';
    case 'build_gate_passed': return 'Build Passed';
    case 'antipattern_found': return 'Antipattern';
    case 'state_saved': return 'State Saved';
    case 'command_received': return 'Command';
    case 'command_acknowledged': return 'Acknowledged';
    case 'hierarchy_assessed': return 'Hierarchy';
    case 'session_started': return 'Session Start';
    case 'session_ended': return 'Session End';
    case 'shutdown_started': return 'Shutdown';
    default: return type.replace(/_/g, ' ');
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

        {/* Event icon */}
        <EventIcon type={event.type} color={color} />

        {/* Event type label badge */}
        <span
          className="flex-shrink-0 text-[0.6rem] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded"
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            background: `${color}14`,
            color,
            border: `1px solid ${color}28`,
            minWidth: '5.5rem',
            textAlign: 'center',
          }}
        >
          {getEventLabel(event.type)}
        </span>

        {/* Description */}
        <span
          className="flex-1 text-[0.82rem] text-[#c5d0e6] truncate"
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
