'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Card } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useProject } from '@/contexts/project-context';
import { useWs } from '@/contexts/websocket-context';
import { CardGroup } from '@/components/board/card-group';

function groupCards(cards: Card[]): {
  active: Card[];
  queue: Card[];
  done: Card[];
} {
  const active: Card[] = [];
  const queue: Card[] = [];
  const done: Card[] = [];

  for (const card of cards) {
    if (card.status === 'in_progress' || card.status === 'failed') {
      active.push(card);
    } else if (card.status === 'done' || card.status === 'skipped') {
      done.push(card);
    } else {
      // backlog, review, testing → Queue
      queue.push(card);
    }
  }

  return { active, queue, done };
}

export default function BoardPage() {
  const { projectId } = useProject();
  const { data: initial, setData } = useApiQuery<Card[]>(
    projectId ? `/api/projects/${projectId}/cards` : null
  );
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const { subscribe } = useWs();

  // Sync from initial fetch
  useEffect(() => {
    if (initial) setCards(initial);
  }, [initial]);

  // Subscribe to real-time card updates
  const handleMessage = useCallback((msg: import('@vldr/shared').ServerMessage) => {
    if (msg.type === 'card:updated') {
      const updated = msg.data;
      setCards(prev => {
        const idx = prev.findIndex(c => c.id === updated.id);
        if (idx === -1) return [...prev, updated];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    }
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return cards;
    const q = search.trim().toLowerCase();
    return cards.filter(
      c => c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)
    );
  }, [cards, search]);

  const { active, queue, done } = useMemo(() => groupCards(filtered), [filtered]);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      {/* Search bar */}
      <div className="mb-8 kindle">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards..."
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

      {/* Card groups */}
      <div className="space-y-8">
        <div className="kindle kindle-1">
          <CardGroup
            title="Active"
            count={active.length}
            cards={active}
            variant="active"
            defaultOpen={true}
          />
        </div>

        <div className="kindle kindle-2">
          <CardGroup
            title="Queue"
            count={queue.length}
            cards={queue}
            variant="queue"
            defaultOpen={true}
          />
        </div>

        <div className="kindle kindle-3">
          <CardGroup
            title="Done"
            count={done.length}
            cards={done}
            variant="done"
            defaultOpen={false}
          />
        </div>
      </div>

      {/* Empty state */}
      {cards.length === 0 && (
        <div
          className="text-center py-24 kindle kindle-2"
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            color: '#8899b3',
            fontSize: '0.85rem',
          }}
        >
          {projectId ? 'No cards yet.' : 'Select a project to view the board.'}
        </div>
      )}
    </div>
  );
}
