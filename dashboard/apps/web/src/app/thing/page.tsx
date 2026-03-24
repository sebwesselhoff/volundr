'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Team, TeamMessage, ServerMessage } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useWebSocket } from '@/hooks/use-websocket';
import { useTeamData } from '@/hooks/use-team-data';
import { Scene } from '@/components/thing/scene';
import { MessageLog } from '@/components/thing/message-log';

// ---- Team selector (multiple teams) ----

interface TeamSelectorProps {
  teams: Team[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TeamSelector({ teams, selectedId, onSelect }: TeamSelectorProps) {
  if (teams.length <= 1) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        gap: '1.5rem',
      }}
    >
      {teams.map(team => {
        const active = team.id === selectedId;
        return (
          <button
            key={team.id}
            onClick={() => onSelect(team.id)}
            className="focus:outline-none"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem 0',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              fontWeight: 400,
              fontSize: '0.8rem',
              color: active ? '#c5d0e6' : '#8899b3',
              borderBottom: active ? '1px solid #3b82f6' : '1px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {team.name}
          </button>
        );
      })}
    </div>
  );
}

// ---- Inner: scene + data bridge ----

function TeamScene({ team }: { team: Team }) {
  const { members, messages } = useTeamData(team.id);

  const chatMessages: TeamMessage[] = messages
    .filter(m => m.kind === 'chat')
    .map(m => (m as { kind: 'chat'; data: TeamMessage }).data);

  return (
    <Scene
      teamId={team.id}
      teamStatus={team.status}
      members={members}
      messages={chatMessages}
    />
  );
}

// ---- Inner: transcript view ----

function TeamTranscript({ team }: { team: Team }) {
  const { members, messages, isLoading } = useTeamData(team.id);

  const chatMessages: TeamMessage[] = messages
    .filter(m => m.kind === 'chat')
    .map(m => (m as { kind: 'chat'; data: TeamMessage }).data);

  if (isLoading) {
    return (
      <div style={{
        textAlign: 'center',
        paddingTop: '4rem',
        fontFamily: 'var(--font-outfit), Outfit, sans-serif',
        color: '#8899b3',
        fontSize: '0.85rem',
      }}>
        Loading...
      </div>
    );
  }

  return <MessageLog messages={chatMessages} members={members} />;
}

// ---- Page ----

export default function ThingPage() {
  const { data: teamsRaw, loading, refetch } = useApiQuery<Team[]>('/api/teams?status=active');
  const { subscribe } = useWebSocket();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [mode, setMode] = useState<'scene' | 'transcript'>('scene');

  const teams = teamsRaw ?? [];

  // Live-update: refetch team list when teams are created or ended
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'team:created' || msg.type === 'team:ended') {
        refetch();
        // Clear selection when team ends so scene resets
        if (msg.type === 'team:ended' && msg.data?.teamId === selectedTeamId) {
          setSelectedTeamId(null);
        }
      }
    });
    return unsub;
  }, [subscribe, refetch, selectedTeamId]);

  // Auto-select first active team (or new team when it appears)
  useEffect(() => {
    if (teams.length === 0) {
      if (selectedTeamId) setSelectedTeamId(null);
      return;
    }
    // If current selection is gone, pick the first available
    if (!selectedTeamId || !teams.find(t => t.id === selectedTeamId)) {
      const active = teams.find(t => t.status === 'active');
      setSelectedTeamId((active ?? teams[0]).id);
    }
  }, [teams, selectedTeamId]);

  const handleSelect = useCallback((id: string) => setSelectedTeamId(id), []);
  const selectedTeam = teams.find(t => t.id === selectedTeamId) ?? null;

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 5rem)', overflow: 'hidden' }}>
      {/* Team selector overlay */}
      {teams.length > 1 && (
        <TeamSelector teams={teams} selectedId={selectedTeamId} onSelect={handleSelect} />
      )}

      {/* Mode toggle — bottom right */}
      <button
        onClick={() => setMode(m => m === 'scene' ? 'transcript' : 'scene')}
        className="focus:outline-none"
        style={{
          position: 'absolute',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 20,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.65rem',
          color: '#4a5568',
          letterSpacing: '0.05em',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#8899b3')}
        onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
      >
        [{mode === 'scene' ? 'transcript' : 'campfire'}]
      </button>

      {/* Content */}
      {loading ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%',
          fontFamily: 'var(--font-outfit), Outfit, sans-serif',
          color: '#8899b3', fontSize: '0.85rem',
        }}>
          Loading...
        </div>
      ) : mode === 'scene' ? (
        selectedTeam ? (
          <TeamScene key={selectedTeam.id} team={selectedTeam} />
        ) : (
          <Scene teamId={null} teamStatus={null} members={[]} messages={[]} />
        )
      ) : (
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '2.5rem 1.5rem 4rem', height: '100%', overflowY: 'auto' }}>
          {selectedTeam ? (
            <TeamTranscript key={selectedTeam.id} team={selectedTeam} />
          ) : (
            <div style={{
              textAlign: 'center', paddingTop: '4rem',
              fontFamily: 'var(--font-outfit), Outfit, sans-serif',
              color: '#8899b3', fontSize: '0.85rem',
            }}>
              No active teams
            </div>
          )}
        </div>
      )}
    </div>
  );
}
