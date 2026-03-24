import { TEAM_STATUS_SIGNALS } from '@vldr/shared';
import type { TeamMemberStatus } from '@vldr/shared';

export function parseStatusSignal(messageText: string): TeamMemberStatus | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type) {
      if ((TEAM_STATUS_SIGNALS.idle as readonly string[]).includes(parsed.type)) return 'idle';
      if ((TEAM_STATUS_SIGNALS.stopped as readonly string[]).includes(parsed.type)) return 'stopped';
    }
  } catch {
    for (const signal of TEAM_STATUS_SIGNALS.idle) {
      if (messageText.includes(signal)) return 'idle';
    }
    for (const signal of TEAM_STATUS_SIGNALS.stopped) {
      if (messageText.includes(signal)) return 'stopped';
    }
  }
  return null;
}
