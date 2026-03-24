'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Event } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';
import { useWs } from '@/contexts/websocket-context';
import { EventRow } from '@/components/events/event-row';
import { EventFilters, CATEGORY_TYPES, CATEGORIES } from '@/components/events/event-filters';

// All known event types that map to categories
const ALL_TYPED = Object.values(CATEGORY_TYPES).flat();

function getDateKey(ts: string): string {
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function formatGroupHeader(key: string): string {
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  // Format as "March 20, 2026"
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function getCategoryForType(type: string): string {
  for (const cat of CATEGORIES) {
    if (CATEGORY_TYPES[cat].includes(type)) return cat;
  }
  return 'Other';
}

export default function EventsPage() {
  const { projectId } = useProject();
  const { data: initial } = useApiQuery<Event[]>(
    projectId ? `/api/projects/${projectId}/events` : null
  );
  const [events, setEvents] = useState<Event[]>([]);
  const [search, setSearch] = useState('');

  // Active types = set of category names that are "on"
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set(CATEGORIES)
  );

  const { subscribe } = useWs();

  // Sync from initial fetch
  useEffect(() => {
    if (initial) setEvents(initial);
  }, [initial]);

  // Real-time: prepend new events
  const handleMessage = useCallback((msg: import('@vldr/shared').ServerMessage) => {
    if (msg.type === 'event:new') {
      const ev = msg.data;
      setEvents(prev => [ev, ...prev]);
    }
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  // Toggle a category
  const handleToggle = useCallback((category: string) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Build the set of active types from active categories
  const activeTypes = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const cat of activeCategories) {
      const types = CATEGORY_TYPES[cat] ?? [];
      types.forEach(t => s.add(t));
    }
    // Always include "Other" types for uncategorized
    return s;
  }, [activeCategories]);

  // Filtering
  const filtered = useMemo(() => {
    let list = events;

    // Filter by active categories
    list = list.filter(ev => {
      const cat = getCategoryForType(ev.type);
      return activeCategories.has(cat);
    });

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        ev =>
          ev.detail?.toLowerCase().includes(q) ||
          ev.type.toLowerCase().includes(q) ||
          ev.cardId?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [events, activeCategories, search]);

  // Group by date, sorted newest first
  const groups = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const ev of filtered) {
      const key = getDateKey(ev.timestamp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    // Sort groups newest first
    const sorted = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return sorted;
  }, [filtered]);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      {/* Filter bar */}
      <div className="mb-6 kindle">
        <EventFilters activeTypes={activeCategories} onToggle={handleToggle} />
      </div>

      {/* Search input */}
      <div className="mb-8 kindle kindle-1">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search events..."
          className={[
            'w-full bg-transparent text-[0.85rem] text-[#c5d0e6]',
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
      </div>

      {/* Event groups */}
      {groups.length === 0 ? (
        <div
          className="text-center py-24 kindle kindle-2"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            color: '#8899b3',
            fontSize: '0.85rem',
          }}
        >
          {projectId ? 'No events match your filters.' : 'Select a project to view events.'}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([dateKey, groupEvents], groupIdx) => (
            <div
              key={dateKey}
              className={`kindle kindle-${Math.min(groupIdx + 2, 5)}`}
            >
              {/* Group header */}
              <p
                className="mb-3 uppercase tracking-[0.1em]"
                style={{
                  fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                  fontWeight: 500,
                  fontSize: '0.7rem',
                  color: '#8899b3',
                }}
              >
                {formatGroupHeader(dateKey)}
              </p>

              {/* Events in this group */}
              <div className="divide-y divide-[rgba(36,48,68,0.5)]">
                {groupEvents.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className={`kindle kindle-${Math.min(idx + 1, 5)}`}
                  >
                    <EventRow event={ev} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
