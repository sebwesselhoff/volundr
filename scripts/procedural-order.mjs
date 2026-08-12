#!/usr/bin/env node
/**
 * FRW-BL-103 — mechanical checking of PROCEDURAL ORDERING claims.
 *
 * The runtime evidence contract (FRW-BL-045) is strong where it applies: any ISC criterion whose
 * truth depends on runtime behaviour needs a fresh VERIFY block with a command and an exit code.
 * But a whole class of claim has no exit code — "the anti-stub scan ran before the blind reviewer",
 * "the review was offered and the skip announced", "the operator's decision was recorded before
 * acting". Under the runtime contract alone those are either waved through as documentary or
 * asserted with no check at all.
 *
 * ORDERING is the subset worth mechanising, because it is checkable against two real timestamps
 * rather than trust. quality.md §4b requires the anti-stub scan to run BEFORE blind review. In a
 * real session it ran AFTER the reviewers were already spawned and nothing noticed, because nothing
 * verifies procedural ordering. This does.
 *
 * DESIGN:
 *  - Rules are DECLARATIVE and live in ORDERING_RULES. Adding a rule is data, not code.
 *  - FAIL CLOSED on a missing "before" event. A scan that left no trace is indistinguishable from a
 *    scan that never ran, and treating absence as success is the silent-pass failure mode this
 *    project keeps paying for (FRW-BL-092, 113, and the anti-stub --staged flag bug).
 *  - Pure function over an event array, so it is deterministic and testable with no network.
 *  - Timestamps are compared as parsed dates, not strings — the dashboard emits
 *    'YYYY-MM-DD HH:MM:SS' while API writes are ISO, and string compare across those two is wrong.
 *
 * Usage:
 *   node scripts/procedural-order.mjs --card FRW-BL-113
 *   node scripts/procedural-order.mjs --card FRW-BL-113 --project volundr-meta
 * Exit: 0 = ordering satisfied (or rule not applicable), 1 = violation or unverifiable.
 */

import { fileURLToPath } from 'url';

/**
 * Each rule: for a given card, every `after` event must occur STRICTLY LATER than the latest
 * `before` event. `requireBefore` makes the absence of the before-event a violation rather than a
 * pass — set it for anything mandatory.
 */
export const ORDERING_RULES = [
  {
    id: 'anti-stub-before-blind-review',
    source: 'framework/quality.md §4b (MANDATORY — before blind review)',
    before: { type: 'anti_stub_scan' },
    after: { type: 'agent_spawned', detailMatches: /^review spawned|blind review/i },
    requireBefore: true,
    why: 'A stub that reaches the blind reviewer wastes the review and can be scored as real work. '
      + '§4b exists to stop that, and it is an ordering requirement with no exit code.',
  },
];

const parseTime = (t) => {
  if (!t) return null;
  // Dashboard rows are 'YYYY-MM-DD HH:MM:SS' (UTC); API writes are ISO with a Z. Normalise the
  // former to ISO so Date.parse treats both as UTC rather than local time.
  const s = typeof t === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)
    ? t.replace(' ', 'T') + 'Z'
    : t;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
};

const matches = (event, spec) => {
  if (spec.type && event.type !== spec.type) return false;
  if (spec.detailMatches && !spec.detailMatches.test(String(event.detail ?? ''))) return false;
  return true;
};

/**
 * @param {Array} events   dashboard events (any order)
 * @param {string} cardId  the card whose ordering is being checked
 * @param {Array} rules    defaults to ORDERING_RULES
 * @returns {{violations: Array, checked: Array}}
 */
export function checkOrdering(events, cardId, rules = ORDERING_RULES) {
  const list = Array.isArray(events) ? events : [];
  const forCard = list.filter((e) => e && e.cardId === cardId);
  const violations = [];
  const checked = [];

  for (const rule of rules) {
    const befores = forCard.filter((e) => matches(e, rule.before))
      .map((e) => parseTime(e.timestamp)).filter((t) => t !== null);
    const afters = forCard.filter((e) => matches(e, rule.after))
      .map((e) => ({ t: parseTime(e.timestamp), detail: e.detail }))
      .filter((x) => x.t !== null);

    // No `after` event means the ordering has not been exercised yet — not a violation.
    if (afters.length === 0) {
      checked.push({ rule: rule.id, status: 'not-applicable', note: 'no matching after-event for this card yet' });
      continue;
    }

    if (befores.length === 0) {
      if (rule.requireBefore) {
        violations.push({
          rule: rule.id,
          detail: `${cardId}: ${afters.length} "${rule.after.type}" event(s) recorded but NO `
            + `"${rule.before.type}" event at all. Required by ${rule.source}. A step that left no `
            + `trace is indistinguishable from a step that never ran, so this fails closed. ${rule.why}`,
        });
      } else {
        checked.push({ rule: rule.id, status: 'skipped', note: 'no before-event, rule does not require one' });
      }
      continue;
    }

    // The LATEST before-event must still precede the EARLIEST after-event: running the scan again
    // after the reviewer spawned does not repair the ordering.
    const latestBefore = Math.max(...befores);
    const earliestAfter = Math.min(...afters.map((a) => a.t));
    if (latestBefore >= earliestAfter) {
      violations.push({
        rule: rule.id,
        detail: `${cardId}: "${rule.before.type}" at ${new Date(latestBefore).toISOString()} is NOT `
          + `before "${rule.after.type}" at ${new Date(earliestAfter).toISOString()} — out of order by `
          + `${Math.round((latestBefore - earliestAfter) / 1000)}s. Required by ${rule.source}. ${rule.why}`,
      });
    } else {
      checked.push({
        rule: rule.id,
        status: 'ok',
        note: `before ${new Date(latestBefore).toISOString()} < after ${new Date(earliestAfter).toISOString()}`,
      });
    }
  }
  return { violations, checked };
}

/** Attestation shape check (the non-ordering half of a procedural claim). */
export function parseAttestation(text) {
  const src = String(text ?? '');
  const m = src.match(/ATTEST\s*\[([^\]]*)\]/);
  if (!m) return { present: false, what: null, when: null, complete: false };
  const when = (src.match(/^\s*when:\s*(.+)$/m) || [])[1]?.trim() || null;
  const what = (src.match(/^\s*what:\s*(.+)$/m) || [])[1]?.trim() || null;
  return {
    present: true,
    subject: m[1].trim(),
    when,
    what,
    // Deliberately strict: an attestation with no `when` cannot be checked against a timeline, which
    // is the only thing that makes it more than a sentence.
    complete: Boolean(m[1].trim() && when && what),
  };
}

async function main(argv) {
  const cardIdx = argv.indexOf('--card');
  const cardId = cardIdx >= 0 ? argv[cardIdx + 1] : null;
  const projIdx = argv.indexOf('--project');
  const projectId = projIdx >= 0 ? argv[projIdx + 1] : (process.env.VLDR_PROJECT_ID || 'volundr-meta');
  if (!cardId) {
    process.stderr.write('usage: node scripts/procedural-order.mjs --card <CARD-ID> [--project <id>]\n');
    process.exit(1);
  }
  const api = process.env.VLDR_API_URL || 'http://localhost:3141';
  let events;
  try {
    const res = await fetch(`${api}/api/projects/${projectId}/events?limit=500`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    events = await res.json();
  } catch (e) {
    // Fails CLOSED: an unreachable dashboard means the ordering is UNVERIFIED, not satisfied.
    process.stdout.write(`[procedural-order] ERROR cannot verify ordering — dashboard unreachable (${e.message}). `
      + 'Unverified is not the same as satisfied.\n');
    process.exit(1);
  }

  const { violations, checked } = checkOrdering(events, cardId);
  for (const c of checked) process.stdout.write(`[procedural-order] ${c.status.toUpperCase().padEnd(15)} ${c.rule} — ${c.note}\n`);
  for (const v of violations) process.stdout.write(`[procedural-order] VIOLATION      ${v.rule} — ${v.detail}\n`);
  process.stdout.write(`[procedural-order] ${cardId}: ${violations.length} violation(s), ${checked.length} rule(s) checked.\n`);
  process.exit(violations.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
