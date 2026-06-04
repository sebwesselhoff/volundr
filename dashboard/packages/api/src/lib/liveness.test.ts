import { describe, it, expect } from 'vitest';
import { classifyLiveness, toEpochMs, LIVENESS_DEFAULTS } from './liveness.js';

// TS twin of scripts/agent-liveness.test.mjs — keeps the dashboard-side classifier honest.
// (Runs under vitest on main; the authoritative pure-node core is scripts/agent-liveness.mjs.)
const NOW = 1_000_000_000_000;
const { workingMs, stalledMs } = LIVENESS_DEFAULTS;

describe('classifyLiveness (ISC-2 dashboard twin)', () => {
  it('recent activity → working', () => {
    expect(classifyLiveness({ status: 'running', lastActivityMs: NOW }, NOW)).toBe('working');
  });
  it('workingMs boundary → idle', () => {
    expect(classifyLiveness({ status: 'running', lastActivityMs: NOW - workingMs }, NOW)).toBe('idle');
  });
  it('between thresholds → idle', () => {
    expect(classifyLiveness({ status: 'running', lastActivityMs: NOW - (stalledMs - 1) }, NOW)).toBe('idle');
  });
  it('past stalledMs while running → stalled', () => {
    expect(classifyLiveness({ status: 'running', lastActivityMs: NOW - stalledMs }, NOW)).toBe('stalled');
  });
  it('completed agent is never stalled → idle', () => {
    expect(classifyLiveness({ status: 'completed', lastActivityMs: NOW - stalledMs * 5 }, NOW)).toBe('idle');
  });
  it('failed agent is never stalled → idle', () => {
    expect(classifyLiveness({ status: 'failed', lastActivityMs: NOW - stalledMs * 5 }, NOW)).toBe('idle');
  });
  it('process gone + running → stalled regardless of mtime', () => {
    expect(classifyLiveness({ status: 'running', lastActivityMs: NOW, processAlive: false }, NOW)).toBe('stalled');
  });
  it('falls back to startedAt when no lastActivityMs', () => {
    const fresh = new Date(NOW).toISOString();
    expect(classifyLiveness({ status: 'running', startedAt: fresh }, NOW)).toBe('working');
  });
  it('running with no activity signal → idle (not stalled)', () => {
    expect(classifyLiveness({ status: 'running' }, NOW)).toBe('idle');
  });
});

describe('toEpochMs', () => {
  it('parses SQLite "YYYY-MM-DD HH:MM:SS" as UTC', () => {
    expect(toEpochMs('2026-06-04 12:00:00')).toBe(Date.parse('2026-06-04T12:00:00Z'));
  });
  it('parses ISO with zone', () => {
    expect(toEpochMs('2026-06-04T12:00:00Z')).toBe(Date.parse('2026-06-04T12:00:00Z'));
  });
  it('null/garbage → null', () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs('not-a-date')).toBeNull();
  });
});
