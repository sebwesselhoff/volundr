import { useMemo, useState } from 'react';
import type { TeamMember, DisplayMessage } from '@vldr/shared';

export function useMessageFilter(members: TeamMember[], messages: DisplayMessage[]) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const tabs = useMemo(() => {
    const agentNames = [...new Set(members.filter(m => !m.leftAt).map(m => m.name))];
    return ['all', ...agentNames];
  }, [members]);

  const filteredMessages = useMemo(() => {
    if (!selectedAgent) return messages;
    return messages.filter(msg => {
      if (msg.kind === 'system') return true;
      return msg.data.fromAgent === selectedAgent || msg.data.toAgent === selectedAgent;
    });
  }, [messages, selectedAgent]);

  return {
    tabs,
    selectedTab: selectedAgent ?? 'all',
    setSelectedTab: (tab: string) => setSelectedAgent(tab === 'all' ? null : tab),
    filteredMessages,
  };
}
