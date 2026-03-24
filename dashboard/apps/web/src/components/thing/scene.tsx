'use client';

import { useReducer, useEffect, useCallback, useRef } from 'react';
import type { TeamMember, TeamMessage } from '@vldr/shared';
import { Campfire } from './campfire';
import { Silhouette } from './silhouette';
import { SpeechBubble } from './speech-bubble';
import { SEATS } from './seat-layout';
import { sceneReducer, initialState } from './scene-state';
import type { SceneAction } from './scene-state';

const FIRE_X = 50;
const FIRE_Y = 55;

const BUBBLE_DURATION = 5000;

const ROLE_COLORS: Record<string, string> = {
  volundr: '#e8a838',
  developer: '#3b82f6',
  architect: '#60a5fa',
  'qa-engineer': '#10b981',
  'devops-engineer': '#8b8d8f',
  designer: '#a78bfa',
  reviewer: '#c5d0e6',
  researcher: '#06b6d4',
};

function getRoleColor(type: string): string {
  return ROLE_COLORS[type] || '#60a5fa';
}

/**
 * Extract displayable bubble text from a message, filtering out protocol junk.
 * Returns null if the message should not produce a bubble.
 *
 * Priority: summary field (if present and not JSON) > cleaned text > null
 */
function extractBubbleText(text: string, summary: string | null | undefined): string | null {
  const trimmed = text.trim();

  // Skip empty messages
  if (!trimmed) return null;

  // Skip raw JSON protocol messages (task_assignment, idle_notification, shutdown, etc.)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type) return null; // Any typed protocol message → skip
    } catch {
      // Not valid JSON, treat as text
    }
  }

  // If there's a human-readable summary, prefer it (short and meaningful)
  if (summary && !summary.startsWith('{')) {
    return summary;
  }

  // Return the first meaningful sentence/chunk (strip markdown headers, keep it concise)
  let clean = trimmed;
  // Strip markdown headers
  clean = clean.replace(/^#+\s+/gm, '');
  // Take first paragraph only (split on double-newline)
  const firstPara = clean.split(/\n\n/)[0].trim();
  // If still very long, take first sentence
  if (firstPara.length > 120) {
    const firstSentence = firstPara.match(/^[^.!?]+[.!?]/)?.[0];
    return firstSentence || firstPara.slice(0, 120) + '…';
  }

  return firstPara || null;
}

interface SceneProps {
  teamId: string | null;
  teamStatus: string | null;
  members: TeamMember[];
  messages: TeamMessage[];
}

export function Scene({ teamId, teamStatus, members, messages }: SceneProps) {
  const [state, dispatch] = useReducer(sceneReducer, initialState);
  const bubbleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevTeamId = useRef<string | null>(null);
  const processedMessages = useRef<Set<number>>(new Set());

  // Team lifecycle
  useEffect(() => {
    if (teamId && !prevTeamId.current) {
      dispatch({ type: 'TEAM_CREATED' });
      const t = setTimeout(() => dispatch({ type: 'IGNITION_COMPLETE' }), 1500);
      prevTeamId.current = teamId;
      return () => clearTimeout(t);
    }
    if (!teamId && prevTeamId.current) {
      dispatch({ type: 'TEAM_ENDED' });
      const t1 = setTimeout(() => dispatch({ type: 'DISBANDMENT_COMPLETE' }), 5000);
      const t2 = setTimeout(() => dispatch({ type: 'EMBERS_EXPIRED' }), 15000);
      prevTeamId.current = teamId;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    // No active team and state isn't empty — force reset (clears stale agents)
    if (!teamId && state.phase !== 'empty') {
      dispatch({ type: 'RESET' });
    }
    prevTeamId.current = teamId;
  }, [teamId, state.phase]);

  // Track team ended status
  useEffect(() => {
    if (teamStatus === 'ended' && state.phase === 'active') {
      dispatch({ type: 'TEAM_ENDED' });
      const t1 = setTimeout(() => dispatch({ type: 'DISBANDMENT_COMPLETE' }), 5000);
      const t2 = setTimeout(() => dispatch({ type: 'EMBERS_EXPIRED' }), 15000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [teamStatus, state.phase]);

  // Sync members
  useEffect(() => {
    if (state.phase !== 'active' && state.phase !== 'igniting') return;

    const currentIds = new Set(state.agents.map(a => a.id));
    const memberIds = new Set(members.filter(m => !m.leftAt).map(m => m.name));

    // New members
    for (const member of members) {
      if (member.leftAt) continue;
      if (!currentIds.has(member.name)) {
        dispatch({
          type: 'MEMBER_JOINED',
          agent: {
            id: member.name,
            type: member.agentType || 'developer',
            name: member.name,
          },
        });
        // Auto-transition to seated after fade-in completes (600ms matches CSS transition)
        const agentName = member.name;
        setTimeout(() => dispatch({ type: 'AGENT_SEATED', agentId: agentName }), 800);
      }
    }

    // Departed members
    for (const agent of state.agents) {
      if (!memberIds.has(agent.id) && agent.status !== 'leaving') {
        dispatch({ type: 'MEMBER_LEFT', agentId: agent.id });
        setTimeout(() => dispatch({ type: 'MEMBER_REMOVED', agentId: agent.id }), 2500);
      }
    }
  }, [members, state.phase, state.agents]);

  // Process messages → speech bubbles (filtered)
  useEffect(() => {
    for (const msg of messages) {
      if (processedMessages.current.has(msg.id)) continue;
      processedMessages.current.add(msg.id);

      // Filter out protocol/system messages — only show real conversation
      const bubbleText = extractBubbleText(msg.text, msg.summary);
      if (!bubbleText) continue;

      const agentId = msg.fromAgent;
      dispatch({
        type: 'MESSAGE',
        agentId,
        text: bubbleText,
        fromAgent: msg.fromAgent,
      });

      // Clear previous timer for this agent
      const prev = bubbleTimers.current.get(agentId);
      if (prev) clearTimeout(prev);

      // Set expiry timer
      const timer = setTimeout(() => {
        dispatch({ type: 'BUBBLE_EXPIRED', agentId });
        bubbleTimers.current.delete(agentId);
      }, BUBBLE_DURATION);
      bubbleTimers.current.set(agentId, timer);
    }
  }, [messages]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      bubbleTimers.current.forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Campfire */}
      <div style={{ position: 'absolute', left: `${FIRE_X}%`, top: `${FIRE_Y}%`, transform: 'translate(-50%, -50%)' }}>
        <Campfire phase={state.phase} agentCount={state.agents.length} />
      </div>

      {/* Agent silhouettes */}
      {state.agents.map(agent => {
        const seat = SEATS[agent.seatIndex] || SEATS[0];
        return (
          <Silhouette
            key={agent.id}
            type={agent.type}
            name={agent.name}
            status={agent.status}
            color={getRoleColor(agent.type)}
            x={seat.x}
            y={seat.y}
            side={seat.side}
          />
        );
      })}

      {/* Speech bubbles */}
      {state.bubbles.map(bubble => {
        const agent = state.agents.find(a => a.id === bubble.agentId);
        if (!agent) return null;
        const seat = SEATS[agent.seatIndex] || SEATS[0];
        return (
          <SpeechBubble
            key={`${bubble.agentId}-${bubble.timestamp}`}
            text={bubble.text}
            fromAgent={bubble.fromAgent}
            x={seat.x}
            y={seat.y - 12}
            color={getRoleColor(agent.type)}
            entering
          />
        );
      })}

      {/* Summary text (disbanding/embers) */}
      {state.summaryText && (state.phase === 'disbanding' || state.phase === 'embers') && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `${FIRE_Y}%`,
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            maxWidth: '400px',
            fontFamily: '"Cormorant Garamond", serif',
            fontWeight: 500,
            fontSize: '1.1rem',
            color: '#e8a838',
            opacity: state.phase === 'embers' ? 1 : 0.8,
            transition: 'opacity 2s ease',
          }}
        >
          {state.summaryText}
        </div>
      )}

      {/* Empty state text */}
      {state.phase === 'empty' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `${FIRE_Y + 12}%`,
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <p style={{
            fontFamily: '"Cormorant Garamond", serif',
            fontWeight: 500,
            fontSize: '1.1rem',
            color: '#8899b3',
            margin: 0,
          }}>
            No active Thing
          </p>
          <p style={{
            fontFamily: 'var(--font-outfit), Outfit, sans-serif',
            fontSize: '0.8rem',
            color: '#4a5568',
            marginTop: '0.5rem',
          }}>
            Agents will gather when a team forms
          </p>
        </div>
      )}
    </div>
  );
}
