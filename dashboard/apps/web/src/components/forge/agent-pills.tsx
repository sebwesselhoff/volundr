'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '@vldr/shared';
import { useApiQuery } from '@/hooks/use-api';
import { useWs } from '@/contexts/websocket-context';
import { useProject } from '@/contexts/project-context';

function getTypeInitial(type: string): string {
  return type.charAt(0).toUpperCase();
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(prompt: number, completion: number): string {
  const total = prompt + completion;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

interface AgentPillProps {
  agent: Agent;
  isNew?: boolean;
}

function AgentPill({ agent, isNew }: AgentPillProps) {
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);

  // Tick every second to refresh uptime display
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isRunning = agent.status === 'running';

  return (
    <button
      onClick={() => setExpanded(e => !e)}
      className={`inline-flex flex-col items-start text-left cursor-pointer select-none
        focus:outline-none ${isNew ? 'agent-spawn-anim' : ''}`}
      style={{ animation: isNew ? 'agent-spawn 500ms ease-out both' : undefined }}
    >
      {/* Collapsed row */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        {/* Status dot */}
        <span
          className="flex-shrink-0 rounded-full"
          style={{
            width: 6,
            height: 6,
            background: isRunning ? '#3b82f6' : agent.status === 'completed' ? '#e8a838' : '#d4581a',
            animation: isRunning ? 'glow-pulse 2s ease-in-out infinite' : undefined,
          }}
        />
        {/* Type name */}
        <span
          className="text-[0.8rem] text-[#c5d0e6]"
          style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif', fontWeight: 400 }}
        >
          {agent.type}
        </span>
        {/* Inline details when expanded */}
        {expanded && (
          <span
            className="text-[0.72rem] text-[#8899b3]"
            style={{ fontFamily: 'var(--font-jetbrains), "JetBrains Mono", monospace' }}
          >
            {agent.model}
            {' / '}
            {formatUptime(agent.startedAt)}
            <span className="sr-only">{tick}</span>
            {' / '}
            {formatTokens(agent.promptTokens, agent.completionTokens)} tok
            {agent.cardId && ` / ${agent.cardId}`}
          </span>
        )}
      </div>
    </button>
  );
}

export function AgentPills() {
  const { projectId } = useProject();
  const { data: initial, setData } = useApiQuery<Agent[]>(
    projectId ? `/api/projects/${projectId}/agents?status=running` : null
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const { subscribe } = useWs();

  // Sync local state from query result
  useEffect(() => {
    if (initial) setAgents(initial);
  }, [initial]);

  const handleMessage = useCallback((msg: import('@vldr/shared').ServerMessage) => {
    if (msg.type === 'agent:started') {
      const agent = msg.data;
      if (agent.status === 'running') {
        setAgents(prev => {
          if (prev.find(a => a.id === agent.id)) return prev;
          return [...prev, agent];
        });
        setNewIds(prev => new Set(prev).add(agent.id));
        // Clear "new" flag after animation
        setTimeout(() => {
          setNewIds(prev => {
            const next = new Set(prev);
            next.delete(agent.id);
            return next;
          });
        }, 600);
      }
    } else if (msg.type === 'agent:updated') {
      const partial = msg.data;
      setAgents(prev => {
        const updated = prev.map(a =>
          a.id === partial.id ? { ...a, ...partial } : a
        );
        // Remove agents that are no longer running
        return updated.filter(a => a.status === 'running');
      });
    }
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  return (
    <section>
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[#8899b3] mb-3">
        AGENTS
      </p>
      {agents.length === 0 ? (
        <p className="text-[0.8rem] text-[#8899b3]">No active agents</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {agents.map(agent => (
            <AgentPill
              key={agent.id}
              agent={agent}
              isNew={newIds.has(agent.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
