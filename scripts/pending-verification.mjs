#!/usr/bin/env node
/**
 * FRW-BL-111 — the register of ISC criteria that the implementing session CANNOT verify.
 *
 * THE PROBLEM. Some criteria are structurally unobservable by the session that implements them.
 * Hook matcher registration, settings.json env pins and boot artifacts are all read at STARTUP
 * (framework/hook-coverage.md, the registration-vs-body distinction), so a session that widens a
 * matcher cannot watch its own change take effect. Others wait on a human: a judge-calibration
 * re-record refuses to run nested, a GitHub ruleset needs an owner, an env key must be exported by
 * the launcher.
 *
 * Four cards hit this before anything recorded it — FRW-BL-084, 089, 092, 093 — and each one
 * rediscovered the deferral rule independently, then wrote its pending criterion into its own
 * evidence text. That is the failure: the next session learns what is waiting only by opening
 * individual cards it has no reason to open, and a deferred criterion nobody remembers is
 * indistinguishable from an abandoned one.
 *
 * WHY THE EVENT LOG AND NOT A NEW TABLE. The card's technical notes require the register to live in
 * the DB rather than a file, because it is per-project state that must survive a crashed session.
 * `events` already is that: per-project, append-only, crash-durable, free-text `type`. Using it
 * needs NO migration, which matters for more than convenience — the dashboard runs from a published
 * image, so a new table would not exist at runtime until that image is rebuilt, and this card's own
 * ISC could not then be verified in the session that wrote it. Shipping a register whose first act
 * is to be unverifiable would be a joke at this card's expense. A deferral and its resolution are
 * genuinely append-only facts, so the log is the honest shape, not a workaround.
 *
 * STATE IS DERIVED: pending = every `verification_deferred` with no later `verification_resolved`
 * carrying the same key. Nothing is mutated or deleted.
 *
 * TWO GATE KINDS, deliberately distinguished (the card is explicit that conflating them produces a
 * list nobody trusts):
 *   restart  — a NEW SESSION is enough. Nobody needs to be asked. Boot-read state: hook matcher
 *              registration, settings.json env pins, the skills listing, boot artifacts.
 *   operator — a HUMAN must act outside the session, and no number of restarts will do it: run a
 *              recorder from a plain shell, type a slash command, set an env key, change a ruleset.
 *
 * Usage:
 *   node scripts/pending-verification.mjs                       # list pending, one line each (default)
 *   node scripts/pending-verification.mjs --verbose             # + why it was deferred, how to close
 *   node scripts/pending-verification.mjs --gate restart        # only restart-gated
 *   node scripts/pending-verification.mjs --json
 *   node scripts/pending-verification.mjs --add --card FRW-BL-112 --isc ISC-2 \
 *        --gate operator --criterion "..." --why "..." [--how "..."]
 *   node scripts/pending-verification.mjs --resolve --card FRW-BL-093 --isc ISC-4 \
 *        --outcome "..." [--at 2026-08-12T09:39:21Z]
 *
 * Exit: 0 = register read (whether or not anything is pending) or write succeeded.
 *       1 = a write failed, or a --resolve matched no open deferral.
 *       2 = the register could NOT be read. Deliberately distinct from 0: printing "nothing
 *           pending" when nothing was actually checked is the exact silent-pass shape this
 *           project keeps paying for (FRW-BL-092, FRW-BL-113, the anti-stub --staged bug).
 */

import { fileURLToPath } from 'url';

export const DEFERRED_EVENT = 'verification_deferred';
export const RESOLVED_EVENT = 'verification_resolved';

/** The only two gate kinds. Anything else is a typo, and a typo'd gate silently drops an entry
 *  out of every filtered view — so it is rejected at write time rather than stored. */
export const GATES = ['restart', 'operator'];

/**
 * Pure: stable identity for a deferred criterion.
 *
 * A resolution has to find its deferral months later, written by a different session, so the key
 * must not depend on prose that will be re-typed slightly differently. `--isc ISC-2` is the stable
 * form and is preferred. Free-text criteria are normalised (case, whitespace, trailing punctuation)
 * as a fallback, which is weaker but better than requiring a byte-exact re-type.
 */
export function entryKey(cardId, { isc, criterion } = {}) {
  const card = String(cardId ?? '').trim().toUpperCase();
  if (!card) return null;
  const tag = String(isc ?? '').trim().toUpperCase();
  if (tag) return `${card}::${tag}`;
  const text = String(criterion ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
  return text ? `${card}::${text}` : null;
}

/**
 * Pure: read one register event's payload.
 * Returns null for anything that is not a well-formed register entry. Malformed JSON is dropped
 * rather than throwing — one bad row must never blind the whole register at boot.
 */
export function parseEntry(event) {
  if (!event || (event.type !== DEFERRED_EVENT && event.type !== RESOLVED_EVENT)) return null;
  let payload;
  try {
    payload = JSON.parse(String(event.detail ?? ''));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const cardId = event.cardId || payload.card;
  const key = entryKey(cardId, payload);
  if (!key) return null;
  return {
    kind: event.type === DEFERRED_EVENT ? 'deferred' : 'resolved',
    key,
    cardId: String(cardId).toUpperCase(),
    isc: payload.isc ? String(payload.isc).toUpperCase() : null,
    criterion: payload.criterion ?? null,
    gate: payload.gate ?? null,
    why: payload.why ?? null,
    how: payload.how ?? null,
    outcome: payload.outcome ?? null,
    at: payload.at ?? event.timestamp ?? null,
    timestamp: event.timestamp ?? null,
  };
}

/**
 * Pure: derive the open register from an event array.
 *
 * A resolution cancels a deferral with the same key REGARDLESS of order in the array — events
 * arrive newest-first from the API and oldest-first from a file, and a register that changed its
 * answer based on which way it was handed the data would be worthless.
 *
 * @param {Array} events   dashboard events, any order
 * @param {{gate?: string}} [opts]
 * @returns {{pending: Array, resolved: Array, malformed: number}}
 */
export function computePending(events, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const parsed = [];
  let malformed = 0;
  for (const e of list) {
    if (e && (e.type === DEFERRED_EVENT || e.type === RESOLVED_EVENT)) {
      const p = parseEntry(e);
      if (p) parsed.push(p);
      else malformed++;
    }
  }

  const resolvedKeys = new Set(parsed.filter((p) => p.kind === 'resolved').map((p) => p.key));
  const resolutionFor = new Map();
  for (const p of parsed) if (p.kind === 'resolved') resolutionFor.set(p.key, p);

  // Deduplicate deferrals by key — re-registering the same criterion (a second session hitting the
  // same wall) must not produce two rows. Keep the EARLIEST, so "waiting since" is honest.
  const byKey = new Map();
  for (const p of parsed) {
    if (p.kind !== 'deferred') continue;
    const prev = byKey.get(p.key);
    if (!prev || String(p.at ?? '') < String(prev.at ?? '')) byKey.set(p.key, p);
  }

  let pending = [...byKey.values()].filter((p) => !resolvedKeys.has(p.key));
  const resolved = [...byKey.values()]
    .filter((p) => resolvedKeys.has(p.key))
    .map((p) => ({ ...p, resolution: resolutionFor.get(p.key) ?? null }));

  if (opts.gate) pending = pending.filter((p) => p.gate === opts.gate);

  const order = (p) => `${p.gate === 'restart' ? '0' : '1'}${p.cardId}${p.isc ?? ''}`;
  pending.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  resolved.sort((a, b) => (String(a.at) < String(b.at) ? -1 : 1));

  return { pending, resolved, malformed };
}

/**
 * Pure: render the boot-facing report. Restart-gated first — those are the ones THIS boot can act on.
 *
 * COMPACT BY DEFAULT, and that is a design decision rather than a cosmetic one. This runs at every
 * boot. Six entries printed with full `why` and `how` prose is ~50 lines of wall, and a boot banner
 * nobody reads is the same failure as no register at all — just more expensive. One line per entry
 * fits in a glance; `--verbose` is one keystroke away when an entry is actually being worked.
 */
export function formatReport(pending, { malformed = 0, verbose = false } = {}) {
  const lines = [];
  if (pending.length === 0) {
    lines.push('[pending-verification] register read — nothing awaiting verification.');
  } else {
    const restart = pending.filter((p) => p.gate === 'restart');
    const operator = pending.filter((p) => p.gate === 'operator');
    lines.push(`[pending-verification] ${pending.length} criterion/criteria awaiting verification `
      + `(${restart.length} restart-gated, ${operator.length} operator-gated).`);
    if (restart.length) {
      lines.push('');
      lines.push('  RESTART-GATED — this boot IS the new session, so these are actionable NOW:');
      for (const p of restart) lines.push(...renderOne(p, verbose));
    }
    if (operator.length) {
      lines.push('');
      lines.push('  OPERATOR-GATED — a human must act; restarting will not close these:');
      for (const p of operator) lines.push(...renderOne(p, verbose));
    }
    if (!verbose) {
      lines.push('');
      lines.push('  (why each was deferred and how to close it: --verbose, or --json)');
    }
  }
  if (malformed > 0) {
    lines.push('');
    lines.push(`[pending-verification] WARN ${malformed} register event(s) had unreadable payloads `
      + 'and were skipped. They are NOT counted above, so the real total may be higher.');
  }
  return lines.join('\n');
}

/** Pure: trim to one readable line without cutting mid-word. Exported for the self-test. */
export function clip(text, max = 96) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function renderOne(p, verbose) {
  const label = `${p.cardId}${p.isc ? ` ${p.isc}` : ''}`;
  if (!verbose) {
    const since = p.at ? ` [since ${String(p.at).slice(0, 10)}]` : '';
    return [`    - ${label}${since}  ${clip(p.criterion)}`];
  }
  const out = [`    - ${label}${p.at ? `  (deferred ${p.at})` : ''}`];
  if (p.criterion) out.push(`        criterion: ${p.criterion}`);
  if (p.why) out.push(`        why deferred: ${p.why}`);
  if (p.how) out.push(`        how to close: ${p.how}`);
  return out;
}

/**
 * Pure: validate an --add before it becomes an event.
 * `problems` block the write; `warnings` do not. Omitting --isc is a warning rather than an error
 * because a free-text key still works — it is just weaker, since a later resolve has to re-type the
 * criterion closely enough to normalise to the same string.
 */
export function validateAdd({ card, gate, criterion, isc, why } = {}) {
  const problems = [];
  const warnings = [];
  if (!card) problems.push('--card is required (an entry that cannot be traced to a card is not a register entry)');
  if (!GATES.includes(gate)) problems.push(`--gate must be one of ${GATES.join('|')} (got ${gate ?? 'nothing'})`);
  if (!criterion) problems.push('--criterion is required');
  if (!why) problems.push('--why is required — an entry that does not say why it could not be observed in-session is indistinguishable from a card someone simply did not finish');
  if (!isc) warnings.push('--isc omitted (e.g. ISC-2): the entry falls back to a normalised-text key, which a later --resolve must match closely');
  return { problems, warnings };
}

// --- I/O ------------------------------------------------------------------

const API = () => process.env.VLDR_API_URL || 'http://localhost:3141';
const PROJECT = (argv) => {
  const i = argv.indexOf('--project');
  return i >= 0 ? argv[i + 1] : (process.env.VLDR_PROJECT_ID || 'volundr-meta');
};
const arg = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

async function fetchEvents(projectId) {
  const res = await fetch(`${API()}/api/projects/${projectId}/events?limit=1000`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postEvent(projectId, type, cardId, payload) {
  const res = await fetch(`${API()}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, type, cardId, detail: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function main(argv) {
  const projectId = PROJECT(argv);

  if (argv.includes('--add')) {
    const entry = {
      card: arg(argv, '--card'),
      isc: arg(argv, '--isc'),
      gate: arg(argv, '--gate'),
      criterion: arg(argv, '--criterion'),
      why: arg(argv, '--why'),
      how: arg(argv, '--how'),
      at: arg(argv, '--at') || new Date().toISOString(),
    };
    const { problems, warnings } = validateAdd(entry);
    for (const w of warnings) process.stderr.write(`[pending-verification] WARN ${w}\n`);
    if (problems.length) {
      for (const p of problems) process.stderr.write(`[pending-verification] ${p}\n`);
      process.exitCode = 1;
      return;
    }
    try {
      await postEvent(projectId, DEFERRED_EVENT, entry.card, entry);
      process.stdout.write(`[pending-verification] registered ${entry.card}${entry.isc ? ` ${entry.isc}` : ''} `
        + `as ${entry.gate}-gated.\n`);
      process.exitCode = 0;
      return;
    } catch (e) {
      process.stderr.write(`[pending-verification] FAILED to register: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (argv.includes('--resolve')) {
    const card = arg(argv, '--card');
    const isc = arg(argv, '--isc');
    const criterion = arg(argv, '--criterion');
    const outcome = arg(argv, '--outcome');
    const key = entryKey(card, { isc, criterion });
    if (!key || !outcome) {
      process.stderr.write('[pending-verification] --resolve needs --card, --isc (or --criterion) and --outcome\n');
      process.exitCode = 1;
      return;
    }
    let events;
    try {
      events = await fetchEvents(projectId);
    } catch (e) {
      process.stderr.write(`[pending-verification] cannot resolve — register unreadable (${e.message})\n`);
      process.exitCode = 2;
      return;
    }
    const { pending } = computePending(events);
    if (!pending.some((p) => p.key === key)) {
      // Loud, not silent. A resolution that matches nothing would otherwise look like success while
      // the real entry stays pending forever — the precise failure this register exists to prevent.
      process.stderr.write(`[pending-verification] NO OPEN ENTRY matches ${key}. Nothing was resolved.\n`
        + '[pending-verification] Run without arguments to see the open keys.\n');
      process.exitCode = 1;
      return;
    }
    try {
      await postEvent(projectId, RESOLVED_EVENT, card, {
        card, isc, criterion, outcome, at: arg(argv, '--at') || new Date().toISOString(),
      });
      process.stdout.write(`[pending-verification] resolved ${key}.\n`);
      process.exitCode = 0;
      return;
    } catch (e) {
      process.stderr.write(`[pending-verification] FAILED to resolve: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  // default: list
  let events;
  try {
    events = await fetchEvents(projectId);
  } catch (e) {
    process.stdout.write(`[pending-verification] UNKNOWN — the register could not be read (${e.message}).\n`
      + '[pending-verification] This is NOT "nothing pending". Re-run when the dashboard is up.\n');
    process.exitCode = 2;
    return;
  }
  const gate = arg(argv, '--gate');
  const { pending, malformed } = computePending(events, gate ? { gate } : {});
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ pending, malformed }, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(pending, { malformed, verbose: argv.includes('--verbose') }) + '\n');
  }
  process.exitCode = 0;
  return;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
