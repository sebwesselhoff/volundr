export const API_PORT = 3141;
export const WEB_PORT = 3000;
export const HEARTBEAT_INTERVAL = 10_000;
export const METRICS_BROADCAST_INTERVAL = 5_000;
export const COMMAND_ACK_TIMEOUT = 30_000;
export const VLDR_OFFLINE_THRESHOLD = 20_000;
export const WS_RECONNECT_MAX = 30_000;
export const HEALTH_CHECK_RETRY_DELAY = 2_000;
export const HEALTH_CHECK_MAX_RETRIES = 5;
export const SDK_QUEUE_MAX = 1_000;
export const HTTP_TIMEOUT = 5_000;
export const WS_MESSAGE_TIMEOUT = 10_000;

// Pricing per MTok from https://platform.claude.com/docs/en/about-claude/pricing
// Cache creation = 5-minute cache write (1.25x input). Claude Code uses 5m cache by default.
// Cache read = cache hit (0.1x input).
// Last verified: 2026-03-15
export const MODEL_PRICING: Record<string, { input: number; cacheCreation: number; cacheRead: number; output: number }> = {
  'opus-4':   { input: 5.00,  cacheCreation: 6.25,  cacheRead: 0.50, output: 25.00 },
  'sonnet-4': { input: 3.00,  cacheCreation: 3.75,  cacheRead: 0.30, output: 15.00 },
  'haiku-4':  { input: 1.00,  cacheCreation: 1.25,  cacheRead: 0.10, output: 5.00 },
};

// Backward-compatible: cache params default to 0 so existing callers still work
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input
    + (cacheCreationTokens / 1_000_000) * pricing.cacheCreation
    + (cacheReadTokens / 1_000_000) * pricing.cacheRead
    + (outputTokens / 1_000_000) * pricing.output;
}

// --- Agent Teams (browser-safe) ---

export const TEAM_STATUS_SIGNALS = {
  idle: ['idle_notification', 'idle_ping'] as readonly string[],
  stopped: ['shutdown_request', 'shutdown', 'shutdown_approved'] as readonly string[],
} as const;

export const WATCHER_DEBOUNCE_MS = 200;
export const WATCHER_RETRY_MS = 100;
export const CACHE_MAX_TEAMS = 50;

export const GATE_LEVELS: ReadonlyArray<{ level: number; label: string; description: string }> = [
  { level: 1, label: 'Full Autopilot', description: 'Only ask on scope changes' },
  { level: 2, label: 'Milestone Review', description: 'Pause at blueprint, first batch, domain completion' },
  { level: 3, label: 'Card Review', description: 'Show each card before implementing' },
  { level: 4, label: 'Pair Mode', description: 'Discuss every decision' },
];

// Quality scoring scale — all UI normalization and API validation references this
export const SCORE_SCALE = 10;

// Normalize model names to canonical keys that match MODEL_PRICING
export function normalizeModel(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('opus')) return 'opus-4';
  if (lower.includes('sonnet')) return 'sonnet-4';
  if (lower.includes('haiku')) return 'haiku-4';
  return raw;
}
