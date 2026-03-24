'use client';

import { useMemo } from 'react';
import type { TeamMessage, TeamMember } from '@vldr/shared';

// --- Voice color map ---
const VOICE_COLORS: Record<string, string> = {
  architect:           '#3b82f6',  // Steel Blue
  skeptic:             '#d4581a',  // Ember
  pragmatist:          '#60a5fa',  // Ice
  'user advocate':     '#e8a838',  // Gold
  'operations realist':'#c5d0e6',  // Neutral
  designer:            '#a78bfa',  // Purple
};

function getVoiceColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, color] of Object.entries(VOICE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  // Hash the name to a stable color from a palette
  const palette = ['#3b82f6', '#60a5fa', '#e8a838', '#a78bfa', '#d4581a', '#34d399', '#f472b6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Group messages by detecting "ROUND N" markers in text or grouping by time proximity
function groupMessagesByRound(messages: TeamMessage[]): Array<{
  round: number | null;
  messages: TeamMessage[];
}> {
  if (messages.length === 0) return [];

  const groups: Array<{ round: number | null; messages: TeamMessage[] }> = [];
  let currentRound: number | null = null;
  let currentGroup: TeamMessage[] = [];

  for (const msg of messages) {
    // Check if message text signals a new round
    const roundMatch = msg.text.match(/^ROUND\s+(\d+)/i);
    if (roundMatch) {
      if (currentGroup.length > 0) {
        groups.push({ round: currentRound, messages: currentGroup });
        currentGroup = [];
      }
      currentRound = parseInt(roundMatch[1], 10);
    }
    currentGroup.push(msg);
  }

  if (currentGroup.length > 0) {
    groups.push({ round: currentRound, messages: currentGroup });
  }

  // If no rounds were detected, assign round 1
  if (groups.length === 1 && groups[0].round === null) {
    groups[0].round = 1;
  }

  return groups;
}

interface RoundDividerProps {
  round: number;
}

function RoundDivider({ round }: RoundDividerProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        margin: '2rem 0 1.25rem',
      }}
    >
      <span
        style={{
          flex: 1,
          height: 1,
          background: 'rgba(36,48,68,0.5)',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontWeight: 500,
          fontSize: '0.7rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8899b3',
          whiteSpace: 'nowrap',
        }}
      >
        Round {round}
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: 'rgba(36,48,68,0.5)',
        }}
      />
    </div>
  );
}

interface MessageEntryProps {
  message: TeamMessage;
  isNew?: boolean;
}

function MessageEntry({ message, isNew }: MessageEntryProps) {
  const color = getVoiceColor(message.fromAgent);

  return (
    <div
      className={isNew ? 'kindle' : undefined}
      style={{
        padding: '0.75rem 0',
      }}
    >
      {/* Header row: name + timestamp */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '0.35rem',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontWeight: 500,
            fontSize: '0.85rem',
            color,
          }}
        >
          {message.fromAgent}
          {message.toAgent && (
            <span style={{ color: '#8899b3', fontWeight: 400, marginLeft: '0.4rem', fontSize: '0.75rem' }}>
              → {message.toAgent}
            </span>
          )}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
            fontSize: '0.75rem',
            color: '#8899b3',
            flexShrink: 0,
            marginLeft: '1rem',
          }}
        >
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      {/* Message body */}
      <p
        style={{
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          fontWeight: 400,
          fontSize: '0.9rem',
          color: '#c5d0e6',
          lineHeight: 1.6,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.text}
      </p>

      {/* Summary (if present) */}
      {message.summary && (
        <p
          style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontWeight: 400,
            fontSize: '0.78rem',
            color: '#8899b3',
            marginTop: '0.35rem',
            marginBottom: 0,
            fontStyle: 'italic',
          }}
        >
          {message.summary}
        </p>
      )}
    </div>
  );
}

interface MessageLogProps {
  messages: TeamMessage[];
  members: TeamMember[];
  /** IDs of messages that just arrived (to trigger kindle animation) */
  newMessageIds?: Set<number>;
}

export function MessageLog({ messages, members: _members, newMessageIds }: MessageLogProps) {
  const groups = useMemo(() => groupMessagesByRound(messages), [messages]);

  if (messages.length === 0) {
    return (
      <div
        className="kindle"
        style={{
          textAlign: 'center',
          paddingTop: '6rem',
          paddingBottom: '6rem',
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3',
          fontSize: '0.85rem',
        }}
      >
        No messages yet.
      </div>
    );
  }

  return (
    <div>
      {groups.map((group, gIdx) => (
        <div key={gIdx}>
          {/* Round separator — only if we have a round number */}
          {group.round !== null && groups.length > 1 && (
            <RoundDivider round={group.round} />
          )}
          {group.round !== null && groups.length === 1 && gIdx === 0 && (
            <RoundDivider round={group.round} />
          )}

          {/* Messages in this group */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {group.messages.map((msg) => (
              <MessageEntry
                key={msg.id}
                message={msg}
                isNew={newMessageIds?.has(msg.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
