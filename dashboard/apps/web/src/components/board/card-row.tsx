'use client';

import { useState } from 'react';
import type { Card } from '@vldr/shared';
import { cn } from '@/lib/utils';

interface CardRowProps {
  card: Card;
  variant: 'active' | 'queue' | 'done';
  index?: number;
}

// Derive a domain label from the card ID.
// IDs like "CARD-BE-003" → "backend", "CARD-FE-001" → "frontend", etc.
function deriveDomain(id: string): string | null {
  const upper = id.toUpperCase();
  if (upper.includes('-BE-') || upper.includes('-API-')) return 'backend';
  if (upper.includes('-FE-') || upper.includes('-UI-')) return 'frontend';
  if (upper.includes('-DB-') || upper.includes('-DATA-')) return 'database';
  if (upper.includes('-INF-') || upper.includes('-OPS-') || upper.includes('-DO-')) return 'devops';
  if (upper.includes('-QA-') || upper.includes('-TEST-')) return 'qa';
  return null;
}

function StatusDot({ status, variant }: { status: Card['status']; variant: 'active' | 'queue' | 'done' }) {
  const colorMap: Record<string, string> = {
    in_progress: '#60a5fa', // Steel Blue
    done: '#e8a838',        // Gold
    skipped: '#e8a838',     // Gold (goes to done group)
    failed: '#d4581a',      // Ember
    backlog: '#8899b3',     // Muted
    review: '#8899b3',
    testing: '#8899b3',
  };

  const color = colorMap[status] ?? '#8899b3';
  const isPulse = status === 'in_progress';

  return (
    <span
      className="relative flex-shrink-0"
      style={{ width: 6, height: 6 }}
    >
      {isPulse && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ backgroundColor: color, opacity: 0.5 }}
        />
      )}
      <span
        className="relative block rounded-full"
        style={{ width: 6, height: 6, backgroundColor: color }}
      />
    </span>
  );
}

const EXPAND_SECTIONS = ['criteria', 'isc', 'deps', 'quality'] as const;

function ExpandedDetail({ card }: { card: Card }) {
  const hasCriteria = Boolean(card.criteria);
  const hasIsc = card.isc && card.isc.length > 0;
  const hasDeps = card.deps && card.deps.length > 0;

  if (!hasCriteria && !hasIsc && !hasDeps) {
    return (
      <div className="pt-2 pb-1 text-[0.72rem] text-[#8899b3] font-outfit">
        No additional details.
      </div>
    );
  }

  return (
    <div className="pt-2 pb-1 space-y-3">
      {hasCriteria && (
        <div>
          <p
            className="text-[0.65rem] uppercase tracking-[0.1em] text-[#8899b3] mb-1"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 500 }}
          >
            Acceptance Criteria
          </p>
          <p
            className="text-[0.75rem] text-[#8899b3] whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 300 }}
          >
            {card.criteria}
          </p>
        </div>
      )}

      {hasIsc && (
        <div>
          <p
            className="text-[0.65rem] uppercase tracking-[0.1em] text-[#8899b3] mb-1"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 500 }}
          >
            ISC ({card.isc!.filter(i => i.passed).length}/{card.isc!.length} passed)
          </p>
          <ul className="space-y-1">
            {card.isc!.map((item, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-[0.72rem]"
                style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 300 }}
              >
                <span
                  className="mt-px flex-shrink-0"
                  style={{
                    color: item.passed === true ? '#e8a838' : item.passed === false ? '#d4581a' : '#8899b3',
                  }}
                >
                  {item.passed === true ? '✓' : item.passed === false ? '✗' : '○'}
                </span>
                <span className="text-[#8899b3]">{item.criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasDeps && (
        <div>
          <p
            className="text-[0.65rem] uppercase tracking-[0.1em] text-[#8899b3] mb-1"
            style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 500 }}
          >
            Dependencies
          </p>
          <div className="flex flex-wrap gap-1.5">
            {card.deps.map(dep => (
              <span
                key={dep}
                className="text-[0.68rem] px-1.5 py-0.5 rounded text-[#8899b3]"
                style={{
                  fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
                  background: 'rgba(36,48,68,0.5)',
                  border: '1px solid rgba(36,48,68,0.8)',
                }}
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CardRow({ card, variant, index = 0 }: CardRowProps) {
  const [expanded, setExpanded] = useState(false);

  const isActive = variant === 'active';
  const isMuted = variant === 'queue' || variant === 'done';

  const idColor = isActive ? '#e8a838' : '#8899b3';
  const titleColor = isActive ? '#c5d0e6' : '#8899b3';

  const domain = deriveDomain(card.id);

  // Stagger: cap at 5 to reuse existing .kindle-1 … .kindle-5 classes
  const kindleDelay = index < 5 ? `kindle-${index + 1}` : '';

  return (
    <div
      className={cn('kindle', kindleDelay)}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="group w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#3b82f6]/50 rounded"
        style={{ padding: '0.55rem 0' }}
      >
        <div
          className="flex items-center gap-4 transition-transform duration-200 group-hover:translate-x-0.5"
        >
          {/* Card ID */}
          <span
            className="flex-shrink-0 text-[0.78rem] transition-colors duration-200 group-hover:brightness-125"
            style={{
              fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
              fontWeight: 500,
              color: idColor,
              minWidth: '9rem',
            }}
          >
            {card.id}
          </span>

          {/* Title */}
          <span
            className="flex-1 min-w-0 truncate text-[0.85rem] transition-colors duration-200 group-hover:brightness-125"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontWeight: 400,
              color: titleColor,
            }}
          >
            {card.title}
          </span>

          {/* Assignee (domain derived from card ID) */}
          {domain && (
            <span
              className="flex-shrink-0 text-[0.75rem] text-right hidden sm:block"
              style={{
                fontFamily: 'var(--font-outfit), Outfit, sans-serif',
                fontWeight: 300,
                color: '#8899b3',
                minWidth: '8rem',
              }}
            >
              domain-dev ({domain})
            </span>
          )}

          {/* Status dot */}
          <span className="flex-shrink-0 flex items-center">
            <StatusDot status={card.status} variant={variant} />
          </span>

          {/* Status label */}
          <span
            className="flex-shrink-0 text-[0.7rem] w-20 text-right"
            style={{
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontWeight: 300,
              color: '#8899b3',
            }}
          >
            {card.status === 'in_progress'
              ? 'running'
              : card.status === 'done'
              ? 'done'
              : card.status === 'failed'
              ? 'failed'
              : card.status === 'skipped'
              ? 'skipped'
              : card.status}
          </span>
        </div>
      </button>

      {/* Expandable detail panel */}
      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: expanded ? 600 : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div
          className="ml-[9.5rem] mr-4 border-l-2 pl-4"
          style={{ borderColor: 'rgba(36,48,68,0.7)' }}
        >
          <ExpandedDetail card={card} />
        </div>
      </div>
    </div>
  );
}
