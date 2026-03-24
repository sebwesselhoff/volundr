'use client';

import { useEffect, useState } from 'react';
import type { Agent, AgentStatus } from '@vldr/shared';
import { useWs } from '@/contexts/websocket-context';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(agent: Agent): string {
  const start = new Date(agent.startedAt).getTime();
  const end = agent.completedAt ? new Date(agent.completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  running:   '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
  timeout:   '#f59e0b',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  running:   'running',
  completed: 'completed',
  failed:    'failed',
  timeout:   'timeout',
};

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: Agent }) {
  const totalTokens = agent.promptTokens + agent.completionTokens +
    (agent.cacheCreationTokens ?? 0) + (agent.cacheReadTokens ?? 0);
  const statusColor = STATUS_COLOR[agent.status] ?? '#8899b3';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1.5rem',
        padding: '0.6rem 0',
        borderBottom: '1px solid rgba(36,48,68,0.4)',
        flexWrap: 'wrap',
      }}
    >
      {/* Type */}
      <span style={{
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.8rem',
        color: '#c5d0e6',
        minWidth: 140,
      }}>
        {agent.type}
      </span>

      {/* Model */}
      <span style={{
        fontFamily: 'var(--font-outfit), Outfit, sans-serif',
        fontWeight: 300,
        fontSize: '0.75rem',
        color: '#8899b3',
        minWidth: 80,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: 180,
      }} title={agent.model}>
        {agent.model ? agent.model.split('-').slice(-2).join('-') : '—'}
      </span>

      {/* Card ID */}
      {agent.cardId && (
        <span style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.7rem',
          color: '#60a5fa',
          minWidth: 80,
        }}>
          {agent.cardId}
        </span>
      )}

      {/* Status dot + label */}
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 90 }}>
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
          boxShadow: agent.status === 'running' ? `0 0 6px ${statusColor}` : 'none',
        }} />
        <span style={{
          fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
          fontSize: '0.75rem',
          color: statusColor,
        }}>
          {STATUS_LABEL[agent.status] ?? agent.status}
        </span>
      </span>

      {/* Tokens */}
      <span style={{
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.75rem',
        color: '#8899b3',
        minWidth: 60,
      }}>
        {formatTokens(totalTokens)}
      </span>

      {/* Cost */}
      <span style={{
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.75rem',
        color: '#e8a838',
        minWidth: 60,
      }}>
        ${(agent.estimatedCost ?? 0).toFixed(4)}
      </span>

      {/* Duration */}
      <span style={{
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.75rem',
        color: '#8899b3',
        marginLeft: 'auto',
      }}>
        {formatDuration(agent)}
      </span>
    </div>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────

function ColHeaders() {
  const HEADER_STYLE: React.CSSProperties = {
    fontFamily: 'var(--font-outfit), Outfit, sans-serif',
    fontWeight: 500,
    fontSize: '0.65rem',
    color: '#4a5568',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1.5rem',
      paddingBottom: '0.5rem',
      borderBottom: '1px solid rgba(36,48,68,0.6)',
      marginBottom: '0.25rem',
      flexWrap: 'wrap',
    }}>
      <span style={{ ...HEADER_STYLE, minWidth: 140 }}>Type</span>
      <span style={{ ...HEADER_STYLE, minWidth: 80 }}>Model</span>
      <span style={{ ...HEADER_STYLE, minWidth: 90 }}>Status</span>
      <span style={{ ...HEADER_STYLE, minWidth: 60 }}>Tokens</span>
      <span style={{ ...HEADER_STYLE, minWidth: 60 }}>Cost</span>
      <span style={{ ...HEADER_STYLE, marginLeft: 'auto' }}>Duration</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface AgentsTabProps {
  agents: Agent[] | null;
  loading: boolean;
}

export function AgentsTab({ agents: initialAgents, loading }: AgentsTabProps) {
  const { subscribe } = useWs();
  const [agents, setAgents] = useState<Agent[]>(initialAgents ?? []);

  // Sync when parent passes new data
  useEffect(() => {
    if (initialAgents) setAgents(initialAgents);
  }, [initialAgents]);

  // Live updates
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'agent:started') {
        setAgents((prev) => {
          if (prev.find((a) => a.id === msg.data.id)) return prev;
          return [msg.data, ...prev];
        });
      } else if (msg.type === 'agent:updated') {
        setAgents((prev) =>
          prev.map((a) => (a.id === msg.data.id ? { ...a, ...msg.data } : a))
        );
      }
    });
  }, [subscribe]);

  if (loading) {
    return (
      <div style={{
        height: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.75rem',
        color: '#4a5568',
      }}>
        loading agents...
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <div style={{
        height: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.75rem',
        color: '#4a5568',
      }}>
        no agents spawned yet
      </div>
    );
  }

  // Newest first
  const sorted = [...agents].sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  // Running agents get their own section at top
  const running = sorted.filter((a) => a.status === 'running');
  const finished = sorted.filter((a) => a.status !== 'running');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <ColHeaders />

      {/* Running agents */}
      {running.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          {running.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Finished agents */}
      <div>
        {finished.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </div>

      {/* Footer count */}
      <div style={{
        marginTop: '1.5rem',
        fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace',
        fontSize: '0.7rem',
        color: '#4a5568',
      }}>
        {agents.length} agent{agents.length !== 1 ? 's' : ''} total
        {running.length > 0 && ` · ${running.length} running`}
      </div>
    </div>
  );
}
