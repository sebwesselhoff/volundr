import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500 shadow-emerald-500/40',
  running: 'bg-emerald-500 shadow-emerald-500/40',
  idle: 'bg-amber-400 shadow-amber-400/40',
  stopped: 'bg-zinc-500',
  left: 'bg-zinc-600',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500 shadow-red-500/40',
  timeout: 'bg-amber-400',
};

interface AgentStatusDotProps {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function AgentStatusDot({ status, size = 'sm', className }: AgentStatusDotProps) {
  const colorClass = STATUS_COLORS[status] ?? 'bg-zinc-500';
  const sizeClass = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  const isActive = status === 'active' || status === 'running';

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        sizeClass,
        colorClass,
        isActive && 'shadow-sm',
        className,
      )}
      title={status}
    />
  );
}
