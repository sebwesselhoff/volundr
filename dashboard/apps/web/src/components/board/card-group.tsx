'use client';

import { useState } from 'react';
import type { Card } from '@vldr/shared';
import { CardRow } from './card-row';

interface CardGroupProps {
  title: string;
  count: number;
  cards: Card[];
  variant: 'active' | 'queue' | 'done';
  defaultOpen?: boolean;
}

export function CardGroup({ title, count, cards, variant, defaultOpen = true }: CardGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  const label = `${title.toUpperCase()} · ${count}`;

  return (
    <section>
      {/* Section header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left mb-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#3b82f6]/50 rounded group"
        style={{ padding: '0.35rem 0' }}
        aria-expanded={open}
      >
        <span
          className="text-[0.7rem] uppercase tracking-[0.1em] text-[#8899b3] font-outfit font-medium select-none"
          style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 500, letterSpacing: '0.1em' }}
        >
          {label}
        </span>
        {/* Collapse arrow */}
        <span
          className="text-[#8899b3] ml-1 transition-transform duration-200"
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            fontSize: '0.6rem',
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {/* Subtle separator above content */}
      <div
        style={{
          height: 1,
          background: 'rgba(36,48,68,0.3)',
          marginBottom: '0.25rem',
        }}
      />

      {/* Card list */}
      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: open ? cards.length * 200 + 300 : 0,
          opacity: open ? 1 : 0,
        }}
      >
        {cards.length === 0 ? (
          <p
            className="py-3 text-[0.75rem]"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', color: '#8899b3', fontWeight: 300 }}
          >
            No cards.
          </p>
        ) : (
          <div>
            {cards.map((card, i) => (
              <CardRow
                key={card.id}
                card={card}
                variant={variant}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
