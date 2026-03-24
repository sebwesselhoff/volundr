'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Event } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useWs } from '@/contexts/websocket-context';
import { useProject } from '@/contexts/project-context';

type EventType = Event['type'];

function getEventColor(type: EventType): string {
  switch (type) {
    case 'agent_spawned':
    case 'agent_completed':
    case 'agent_timeout':
      return '#3b82f6'; // Steel Blue — agent events
    case 'quality_scored':
    case 'milestone_reached':
    case 'card_status_changed':
    case 'branch_merged':
    case 'checkpoint_created':
      return '#e8a838'; // Gold — completions/quality
    case 'error':
    case 'build_gate_failed':
    case 'antipattern_found':
    case 'retry_triggered':
      return '#d4581a'; // Ember — failures
    default:
      return '#60a5fa'; // Ice — info/default
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface FeedLineProps {
  event: Event;
  isNew?: boolean;
}

function FeedLine({ event, isNew }: FeedLineProps) {
  const color = getEventColor(event.type);

  return (
    <div
      className="flex items-center gap-3 min-w-0"
      style={{
        height: '2.5rem',
        animation: isNew ? 'slide-in-left 300ms ease-out both' : undefined,
      }}
    >
      {/* Timestamp */}
      <span
        className="flex-shrink-0 text-[0.75rem] text-[#8899b3]"
        style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace', minWidth: '5.5rem' }}
      >
        {formatTimestamp(event.timestamp)}
      </span>

      {/* Color dot */}
      <span
        className="flex-shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: color }}
      />

      {/* Description */}
      <span
        className="flex-1 text-[0.85rem] text-[#c5d0e6] truncate"
        style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
      >
        {event.detail}
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
    </div>
  );
}

export function LiveFeed() {
  const { projectId } = useProject();
  const { data: initial } = useApiQuery<Event[]>(
    projectId ? `/api/projects/${projectId}/events?limit=30` : null
  );
  const [events, setEvents] = useState<Event[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const { subscribe } = useWs();
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync from initial fetch
  useEffect(() => {
    if (initial) setEvents(initial);
  }, [initial]);

  const handleMessage = useCallback((msg: import('@vldr/shared').ServerMessage) => {
    if (msg.type === 'event:new') {
      const ev = msg.data;
      setEvents(prev => [ev, ...prev].slice(0, 100));
      setNewIds(prev => new Set(prev).add(ev.id));
      setTimeout(() => {
        setNewIds(prev => {
          const next = new Set(prev);
          next.delete(ev.id);
          return next;
        });
      }, 400);
    }
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  // Scroll to top on new events (newest first)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length]);

  return (
    <section>
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#8899b3] mb-3">
        FEED
      </p>
      <div
        ref={containerRef}
        className="overflow-y-auto relative"
        style={{ maxHeight: '18rem' }}
      >
        {events.length === 0 ? (
          <p className="text-[0.8rem] text-[#8899b3] h-10 flex items-center">No events yet</p>
        ) : (
          <div className="flex flex-col divide-y divide-[rgba(36,48,68,0.5)]">
            {events.map(ev => (
              <FeedLine
                key={ev.id}
                event={ev}
                isNew={newIds.has(ev.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
