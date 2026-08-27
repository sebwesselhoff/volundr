#!/usr/bin/env node
/**
 * agent-ttl-guard.test.mjs — FRW-BL-095 (second source).
 *
 * WHY THIS TEST EXISTS, AND WHY IT LIVES HERE RATHER THAN IN THE API PACKAGE.
 *
 * The API's agent TTL sweep compares `agents.started_at` against a cutoff with SQL `lt()`, which
 * for SQLite TEXT columns is a LEXICOGRAPHIC comparison. `started_at` is written by
 * `datetime('now')` as `'YYYY-MM-DD HH:MM:SS'` — space-separated, no zone marker. The cutoff was
 * built with `.toISOString()` → `'YYYY-MM-DDTHH:MM:SS.sssZ'`. At index 10 the stored value has a
 * space (0x20) and the cutoff has 'T' (0x54); 0x20 < 0x54 unconditionally, so EVERY non-volundr
 * running row compared as older than the cutoff no matter its real age, and the 10-minute sweep
 * marked every live subagent `completed` — silently, emitting no `agent_completed` event.
 *
 * Measured on 2026-08-27: `listing-probe-095` killed at 11:33:14Z aged 9 minutes,
 * `reviewer-frw-bl-114` at 11:53:14Z aged 2 minutes, with `TTL cleanup: marked 1 orphaned
 * agent(s) as completed` in the container log for each.
 *
 * The natural home for a unit test is `dashboard/packages/api` (and one lives there too), but
 * **CI does not run the dashboard's vitest suite** — `.github/workflows/ci.yml` runs only
 * `turbo typecheck` and `turbo build` for the dashboard. The framework self-test job, which DOES
 * run everything matching `*.test.mjs` under `framework scripts .claude/hooks`, is therefore the
 * only place a regression here would actually be caught. So this file carries the guard:
 *   1. a pure proof of the ordering invariant, which needs no imports at all, and
 *   2. a source assertion that the cutoff is still format-matched to the column.
 *
 * Dependency-free by project constraint: no npm deps, bare Node, exit code is the result.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_INDEX = join(HERE, '..', 'dashboard', 'packages', 'api', 'src', 'index.ts');

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The fix, restated purely so the invariant is testable without importing TypeScript. */
function ttlCutoff(nowMs, ttlMs) {
  return new Date(nowMs - ttlMs).toISOString().replace('T', ' ').slice(0, 19);
}

/** How SQLite's datetime('now') writes the column. */
function sqliteStamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

const TTL = 4 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-27T11:33:14Z');

// --- 1. The bug, reproduced. A bare ISO cutoff mis-sorts against the real column format. -------
{
  const isoCutoff = new Date(NOW - TTL).toISOString();
  const freshAgent = sqliteStamp(NOW - 9 * 60 * 1000); // 9 minutes old — must NOT be swept

  check('repro: fresh agent wrongly compares as stale against an ISO cutoff',
    freshAgent < isoCutoff,
    'expected the historical bug to reproduce; if this now fails the premise changed');

  check('repro: the mis-sort is caused by the separator char, not the time',
    ' '.charCodeAt(0) < 'T'.charCodeAt(0),
    'space (0x20) must sort before T (0x54) for the explanation to hold');

  const zeroSecondAgent = sqliteStamp(NOW);
  check('repro: even a zero-second-old agent compares as stale against an ISO cutoff',
    zeroSecondAgent < isoCutoff);
}

// --- 2. The fix. A format-matched cutoff sorts chronologically. --------------------------------
{
  const cutoff = ttlCutoff(NOW, TTL);

  check('fix: cutoff is space-formatted, not ISO',
    !cutoff.includes('T') && !cutoff.includes('Z'),
    `got ${JSON.stringify(cutoff)}`);

  check('fix: cutoff is the same width as the column format',
    cutoff.length === 19 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(cutoff),
    `got ${JSON.stringify(cutoff)}`);

  // Fresh agents survive.
  for (const ageMin of [0, 1, 9, 59, 239]) {
    const started = sqliteStamp(NOW - ageMin * 60 * 1000);
    check(`fix: agent aged ${ageMin}min is NOT swept`, !(started < cutoff),
      `started=${started} cutoff=${cutoff}`);
  }

  // Genuinely stale agents are still swept — the sweep must not become a no-op.
  for (const ageMin of [241, 300, 60 * 24]) {
    const started = sqliteStamp(NOW - ageMin * 60 * 1000);
    check(`fix: agent aged ${ageMin}min IS still swept`, started < cutoff,
      `started=${started} cutoff=${cutoff}`);
  }

  // Boundary: exactly at the TTL is not yet past it.
  const exactly = sqliteStamp(NOW - TTL);
  check('fix: agent exactly at the TTL boundary is not swept', !(exactly < cutoff));
}

// --- 3. Source guard. The cutoff must stay format-matched in the actual API. -------------------
{
  let src = '';
  try {
    src = readFileSync(API_INDEX, 'utf8');
  } catch (err) {
    check('source: dashboard API index.ts is readable', false, String(err.message));
  }

  if (src) {
    check('source: a ttlCutoff helper exists',
      /function ttlCutoff\s*\(/.test(src),
      'the cutoff must go through a named, testable helper');

    check('source: ttlCutoff converts the ISO separator to a space',
      /ttlCutoff[\s\S]{0,400}?replace\(\s*['"]T['"]\s*,\s*['"] ['"]\s*\)/.test(src),
      'cutoff must be formatted to match the started_at column');

    // The regression we are actually guarding: a bare toISOString() feeding the TTL comparison.
    const cleanupBody = src.slice(src.indexOf('function runAgentTtlCleanup'));
    const upToQuery = cleanupBody.slice(0, cleanupBody.indexOf('staleAgents'));
    check('source: the cutoff is not built with a bare toISOString()',
      !/const\s+cutoff\s*=\s*new Date\([^)]*\)\.toISOString\(\)\s*;/.test(upToQuery),
      'this is the exact FRW-BL-095 second-source regression');
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
