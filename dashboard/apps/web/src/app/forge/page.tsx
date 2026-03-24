'use client';

import { AgentPills } from '@/components/forge/agent-pills';
import { LiveFeed } from '@/components/forge/live-feed';
import { ProgressBar } from '@/components/forge/progress-bar';

export default function ForgePage() {
  return (
    <div className="max-w-5xl mx-auto px-8 py-12 space-y-16">
      <AgentPills />
      <LiveFeed />
      <ProgressBar />
    </div>
  );
}
