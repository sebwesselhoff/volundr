#!/usr/bin/env node
/**
 * memory-retire.mjs — deterministic, interval-gated retirement pass for Volundr's memory stores
 * (FRW-BL-105)
 *
 * THE PROBLEM. Lessons (project + global), reusable patterns under `VLDR_HOME/global/patterns/`,
 * and skills promoted by `extractSkillsFromHistory` (dashboard/packages/api/src/lib/extract-skills.ts)
 * only ever grow. Nothing retires any of it, and there is no rollback if a bad entry gets promoted.
 * Past 100+ global lessons this is not a cosmetic problem: retrieval quality falls and the
 * three-tier memory discipline (framework/system-instructions.md) spends its budget re-reading stale
 * entries instead of the ones that still matter.
 *
 * THE SHAPE (reimplemented from hermes-agent's curator.py — SHAPE ONLY, own wording, own
 * interfaces; see framework/provenance.md row 3, "a mechanism or design reimplemented in Volundr's
 * own wording against Volundr's own interfaces" — no entry required, nothing vendored):
 *   - a pure, deterministic pass, gated to run at most once per `intervalDays`
 *   - a two-stage age ladder: active -> stale -> archive-candidate
 *   - pinning and reference-protection so a lesson cited by an active steering rule, or a pattern
 *     cited by a card, is UNSWEEPABLE regardless of age — this is what makes the pass safe to run
 *     at all
 *   - archive, never delete: a snapshot is written before any mutation, and a restore reverses it
 *
 * OUT OF SCOPE (per the card): automatic deletion without a human confirming, and any
 * LLM-judgement step. The whole pass is arithmetic and substring search over data already on disk
 * or in the dashboard DB — reviewable, and re-runnable to the same answer.
 *
 * DESIGN NOTE — "archive" is an external ledger, not a schema change. Lessons and skills live in the
 * dashboard DB (`dashboard/packages/db`) via HTTP, and neither table has an archived/status column
 * today. Adding one is a migration + retrieval-side wiring change that is out of this script's file
 * scope (scripts/memory-retire.mjs + its test only). So archival for DB-backed items is recorded in
 * a local ledger (`VLDR_HOME/projects/{id}/memory-retire/ledger.json`) that this script owns end to
 * end: append-only, reason-per-entry, restore = mark restored, never delete. Pattern files (plain
 * files under this script's control) ARE physically moved to a `.archived/` sibling directory and
 * moved back on restore. Wiring the ledger into what the HOT/WARM/COLD tiers actually read is
 * follow-up work outside this card.
 *
 * Pure logic (normalize*, checkInterval, findReference, classifyItem, proposeRetirement, buildSnapshot,
 * restoreFromSnapshot, applyArchival, applyRestore) takes all inputs as plain data and an injected
 * `now` — no Date.now(), no fetch, no fs. A thin main() does the I/O. Self-test:
 * scripts/memory-retire.test.mjs.
 *
 * Usage:
 *   node scripts/memory-retire.mjs                    # propose (dry run), respects interval gate
 *   node scripts/memory-retire.mjs --force             # ignore the interval gate
 *   node scripts/memory-retire.mjs --json               # machine-readable report
 *   node scripts/memory-retire.mjs --confirm --yes      # archive the proposed items (snapshot first)
 *   node scripts/memory-retire.mjs --restore [file]     # restore from a snapshot (latest if omitted)
 *
 * Exit: 0 = the pass ran (whether or not it proposed anything) or a write succeeded.
 *       1 = a write/apply/restore operation failed, or --confirm was given without --yes and nothing
 *           was proposed to act on anyway is NOT this code — that case still exits 0 (it is not an
 *           error to have nothing to confirm).
 *       2 = a required store could not be read. Deliberately distinct from "0 proposals" — printing
 *           "nothing to retire" when a store failed to load is the exact silent-pass shape this
 *           project keeps paying for (framework/system-instructions.md, FRW-BL-092/093/113).
 */

import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// ---- Constants ----------------------------------------------------------------

/** Project-wide defaults. All are days; confidenceFloor is 0-1. */
export const DEFAULTS = Object.freeze({
  intervalDays: 14,      // minimum days between passes (bypassed with --force)
  staleDays: 60,          // active -> stale: no activity/reference in this many days
  archiveDays: 180,       // stale -> archive-candidate unconditionally at this age
  confidenceFloor: 0.4,   // a STALE item below this confidence archives early (see classifyItem)
});

export const KINDS = Object.freeze(['lesson', 'pattern', 'skill']);

/** Reference-scan needles shorter than this are too generic to trust as a match (would over-protect
 *  by matching almost anything) — see findReference. */
export const MIN_NEEDLE_LEN = 8;

/** Numeric stand-in for skills' categorical confidence and patterns' `**Confidence**` word, used only
 *  to compare against confidenceFloor. The skill/pattern's own stored value stays authoritative for
 *  everything else (skills.ts lifecycle demote/promote, extract-skills.ts mapConfidenceLevel) — this
 *  mapping exists solely so this module can reason about "low" numerically. */
export const WORD_CONFIDENCE = Object.freeze({ low: 0.25, medium: 0.55, high: 0.85 });

// ---- Normalization: raw store record -> unified MemoryItem ---------------------
//
// Unified shape: { kind, id, title, createdAt, lastActivityAt, confidence, pinned, raw }
// `confidence` is 0-1 or null (lessons have no confidence concept at all — classifyItem treats
// null as "unknown", never as low). `pinned` defaults false when the store has no such field yet
// (true today for lessons/skills — see the report to main for what was actually verified live).

/** @param {{id:number|string, title:string, createdAt?:string, pinned?:boolean}} row dashboard lesson row */
export function normalizeLesson(row) {
  const id = `lesson-${row?.id}`;
  return {
    kind: 'lesson',
    id,
    title: String(row?.title ?? id),
    createdAt: row?.createdAt ?? null,
    lastActivityAt: row?.createdAt ?? null,
    confidence: null,
    pinned: row?.pinned === true,
    raw: row,
  };
}

/**
 * Parse one pattern markdown file's metadata header. Pattern files follow the structure seen under
 * VLDR_HOME/global/patterns/*.md: `# Pattern — <title>`, then `**Source** ...`, `**Confidence**
 * <Low|Medium|High>`, `**Reuse when** ...`. This module ADDS one new optional line to that
 * convention, `**Pinned** true`, so a pattern can opt out of retirement the same way a lesson/skill
 * row can via its `pinned` field — documented here because no pattern file uses it yet.
 */
export function parsePatternFile(filename, content) {
  const id = String(filename ?? '').replace(/\.md$/i, '');
  const text = String(content ?? '');
  const titleMatch = text.match(/^#\s*Pattern\s*[—-]\s*(.+)$/mi) || text.match(/^#\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : id;
  const confMatch = text.match(/\*\*Confidence\*\*\s*(\w+)/i);
  const confidenceWord = confMatch ? confMatch[1].toLowerCase() : null;
  const confidence = confidenceWord && confidenceWord in WORD_CONFIDENCE ? WORD_CONFIDENCE[confidenceWord] : null;
  const pinned = /\*\*Pinned\*\*\s*(true|yes)/i.test(text);
  const sourceMatch = text.match(/\*\*Source\*\*\s*(.+)$/mi);
  const dateMatch = sourceMatch ? sourceMatch[1].match(/\d{4}-\d{2}-\d{2}/) : null;
  const createdAt = dateMatch ? dateMatch[0] : null;
  return { id, title, confidenceWord, confidence, pinned, createdAt };
}

/** @param {string} filename e.g. "enforcement-must-be-locally-testable.md" @param {string} content file text */
export function normalizePattern(filename, content) {
  const p = parsePatternFile(filename, content);
  return {
    kind: 'pattern',
    id: p.id,
    title: p.title,
    createdAt: p.createdAt,
    lastActivityAt: p.createdAt,
    confidence: p.confidence,
    pinned: p.pinned,
    raw: { filename, content },
  };
}

/** @param {object} row dashboard skill row (GET /api/skills) */
export function normalizeSkill(row) {
  const anchor = row?.lastUsedAt || row?.updatedAt || row?.acquiredAt || row?.createdAt || null;
  const rawConfidence = row?.confidence;
  const confidence = typeof rawConfidence === 'number'
    ? rawConfidence
    : (typeof rawConfidence === 'string' && rawConfidence in WORD_CONFIDENCE ? WORD_CONFIDENCE[rawConfidence] : null);
  return {
    kind: 'skill',
    id: String(row?.id ?? ''),
    title: String(row?.name ?? row?.id ?? ''),
    createdAt: row?.createdAt ?? row?.acquiredAt ?? null,
    lastActivityAt: anchor,
    confidence,
    pinned: row?.pinned === true,
    raw: row,
  };
}

/** Stable "kind:id" identity used by the ledger and by dedup logic. */
export function itemKey(item) {
  return `${item.kind}:${item.id}`;
}

// ---- Interval gate ---------------------------------------------------------------

/**
 * Pure. Whether a pass is due to run. `now` is a REQUIRED injected clock (project rule: clocks are
 * injected, not called) — there is no Date.now() fallback here on purpose, so a caller that forgets
 * to pass one fails loudly instead of silently becoming untestable/non-deterministic.
 * @param {{lastRunAt?: string|null, now: string, intervalDays?: number}} args
 */
export function checkInterval({ lastRunAt = null, now, intervalDays = DEFAULTS.intervalDays } = {}) {
  if (now == null) throw new Error('checkInterval: `now` must be provided (injected clock)');
  if (!lastRunAt) return { due: true, reason: 'no prior run recorded — first pass is always due' };
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) {
    return { due: true, reason: `lastRunAt "${lastRunAt}" is unparseable — treating as never run` };
  }
  const elapsedDays = (new Date(now).getTime() - last.getTime()) / 86_400_000;
  if (elapsedDays >= intervalDays) {
    return { due: true, reason: `${Math.floor(elapsedDays)}d since last run >= interval ${intervalDays}d` };
  }
  return {
    due: false,
    reason: `only ${Math.floor(elapsedDays)}d since last run (interval is ${intervalDays}d, `
      + `${Math.ceil(intervalDays - elapsedDays)}d remaining)`,
  };
}

// ---- Reference protection ---------------------------------------------------------

function containsCI(haystack, needle) {
  if (!haystack || !needle) return false;
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
}

/**
 * Pure. Deterministic, substring-based reference scan — NOT semantic, by design (LLM judgement is
 * explicitly out of scope for this card). An item is "referenced" when its id or its full title
 * appears verbatim (case-insensitive) in the steering-rules text or in some card's title/description/
 * isc text. This under-protects paraphrased references and over-protects nothing, which is the safe
 * direction: ISC-3's mandatory confirm step is the backstop for anything this scan misses.
 * @param {{id:string, title:string}} item
 * @param {{steeringRulesText?: string, cards?: Array<{id:string, title?:string, description?:string, isc?:string}>}} ctx
 * @returns {{referenced: boolean, evidence: string|null}}
 */
export function findReference(item, { steeringRulesText = '', cards = [] } = {}) {
  // A null/undefined entry must not crash the pass. This guard was missing, and the test that
  // claimed to cover it stripped nulls with `.filter(Boolean)` BEFORE calling — so the suite was
  // green while the documented input actually threw. That is the coverage-theatre shape this
  // project's constraints name explicitly; the test now passes the nulls through.
  if (!item || typeof item !== 'object') return { referenced: false, evidence: null };
  const needles = [item.id, item.title]
    .filter((s) => typeof s === 'string' && s.trim().length >= MIN_NEEDLE_LEN)
    .map((s) => s.trim());
  if (needles.length === 0) return { referenced: false, evidence: null };

  const steeringHit = needles.find((n) => containsCI(steeringRulesText, n));
  if (steeringHit) {
    return { referenced: true, evidence: `referenced by an active steering rule (matched "${steeringHit}")` };
  }

  for (const card of Array.isArray(cards) ? cards : []) {
    const haystack = [card?.title, card?.description, card?.isc].filter(Boolean).join('\n');
    const hit = needles.find((n) => containsCI(haystack, n));
    if (hit) {
      return { referenced: true, evidence: `referenced by card ${card?.id ?? '(unknown id)'} (matched "${hit}")` };
    }
  }

  return { referenced: false, evidence: null };
}

// ---- Classification: active -> stale -> archive-candidate --------------------------

/**
 * Pure. `now` is a REQUIRED injected clock, same reasoning as checkInterval.
 *
 * Confidence has real teeth here, not decoration: a STALE item (past staleDays) with a KNOWN
 * confidence below confidenceFloor is promoted straight to archive-candidate without waiting for
 * the full archiveDays window — "old and already shown to be low-value" should not get the same
 * grace period as "old but nothing says it's bad". An item with confidence === null (lessons; a
 * skill/pattern with no parseable confidence) never gets this acceleration — absence of a confidence
 * signal is treated as "unknown", never as "low".
 * @param {{createdAt:?string, lastActivityAt:?string, confidence:?number}} item
 * @param {{now:string, staleDays?:number, archiveDays?:number, confidenceFloor?:number}} args
 */
export function classifyItem(item, {
  now,
  staleDays = DEFAULTS.staleDays,
  archiveDays = DEFAULTS.archiveDays,
  confidenceFloor = DEFAULTS.confidenceFloor,
} = {}) {
  if (now == null) throw new Error('classifyItem: `now` must be provided (injected clock)');

  const anchor = item?.lastActivityAt || item?.createdAt || null;
  if (!anchor) {
    return { state: 'active', ageDays: null, reason: 'no timestamp available — treated as active (cannot prove staleness)' };
  }
  const anchorDate = new Date(anchor);
  const ageDays = Math.floor((new Date(now).getTime() - anchorDate.getTime()) / 86_400_000);
  if (Number.isNaN(ageDays) || ageDays < 0) {
    return { state: 'active', ageDays: null, reason: `unparseable or future timestamp "${anchor}" — treated as active` };
  }

  const confidence = typeof item?.confidence === 'number' ? item.confidence : null;
  const lowConfidence = confidence != null && confidence < confidenceFloor;

  if (ageDays >= archiveDays) {
    const confPart = confidence != null ? `, confidence ${confidence} (floor ${confidenceFloor})` : '';
    return {
      state: 'archive-candidate',
      ageDays,
      reason: `age ${ageDays}d since ${anchor} >= archive threshold ${archiveDays}d${confPart}`,
    };
  }

  if (ageDays >= staleDays) {
    if (lowConfidence) {
      return {
        state: 'archive-candidate',
        ageDays,
        reason: `stale (${ageDays}d since ${anchor} >= stale threshold ${staleDays}d) AND confidence `
          + `${confidence} < floor ${confidenceFloor} — no reference or pin evidenced, promoted to `
          + `archive-candidate without waiting for the full ${archiveDays}d window`,
      };
    }
    return {
      state: 'stale',
      ageDays,
      reason: `age ${ageDays}d since ${anchor} >= stale threshold ${staleDays}d`
        + (confidence != null ? `, confidence ${confidence} >= floor ${confidenceFloor} (given full window)` : ''),
    };
  }

  return { state: 'active', ageDays, reason: `age ${ageDays}d since ${anchor} < stale threshold ${staleDays}d` };
}

// ---- Orchestration (pure) -----------------------------------------------------------

/**
 * Pure. The whole propose pass over a set of already-normalized items. No I/O — the caller fetched
 * `items`/`cards`/`steeringRulesText` and injects `now`.
 * @param {{items?: Array, now: string, steeringRulesText?: string, cards?: Array,
 *           lastRunAt?: string|null, force?: boolean, intervalDays?: number, staleDays?: number,
 *           archiveDays?: number, confidenceFloor?: number}} args
 */
export function proposeRetirement({
  items = [],
  now,
  steeringRulesText = '',
  cards = [],
  lastRunAt = null,
  force = false,
  intervalDays,
  staleDays,
  archiveDays,
  confidenceFloor,
} = {}) {
  if (now == null) throw new Error('proposeRetirement: `now` must be provided (injected clock)');

  const interval = checkInterval({ lastRunAt, now, intervalDays });
  if (!interval.due && !force) {
    return { ran: false, reason: interval.reason, proposals: [], protectedItems: [], kept: [] };
  }

  const proposals = [];
  const protectedItems = [];
  const kept = [];

  for (const item of items) {
    // Skip malformed entries rather than crashing the whole pass on one bad row. A retirement pass
    // that dies partway through is worse than one that skips an unreadable entry: the operator sees
    // a stack trace instead of the proposals for everything else.
    if (!item || typeof item !== 'object') {
      kept.push({ item, reason: 'skipped: not a readable item' });
      continue;
    }
    if (item?.pinned === true) {
      protectedItems.push({ item, reason: 'pinned' });
      continue;
    }
    const ref = findReference(item, { steeringRulesText, cards });
    if (ref.referenced) {
      protectedItems.push({ item, reason: ref.evidence });
      continue;
    }
    const classification = classifyItem(item, { now, staleDays, archiveDays, confidenceFloor });
    if (classification.state === 'archive-candidate') {
      proposals.push({ item, reason: classification.reason });
    } else {
      kept.push({ item, state: classification.state, reason: classification.reason });
    }
  }

  return {
    ran: true,
    reason: force && !interval.due ? `forced (interval says: ${interval.reason})` : interval.reason,
    proposals,
    protectedItems,
    kept,
  };
}

/** Pure. Render a proposeRetirement result as a human-readable report. */
export function formatProposalReport(result) {
  const lines = [];
  if (!result.ran) {
    lines.push(`[memory-retire] not due — ${result.reason}. Use --force to run anyway.`);
    return lines.join('\n');
  }
  if (result.proposals.length === 0) {
    lines.push('[memory-retire] pass ran — 0 item(s) proposed for archival.');
  } else {
    lines.push(`[memory-retire] pass ran — ${result.proposals.length} item(s) proposed for archival:`);
    for (const p of result.proposals) {
      lines.push(`  - [${p.item.kind}] ${p.item.id} — ${p.item.title}`);
      lines.push(`      reason: ${p.reason}`);
    }
  }
  if (result.protectedItems.length) {
    lines.push(`[memory-retire] ${result.protectedItems.length} item(s) protected (pinned or referenced), skipped:`);
    for (const p of result.protectedItems) {
      lines.push(`  - [${p.item.kind}] ${p.item.id} — ${p.reason}`);
    }
  }
  lines.push(`[memory-retire] ${result.kept.length} item(s) active/stale, not yet candidates.`);
  return lines.join('\n');
}

// ---- Snapshot / restore (pure) --------------------------------------------------------

/**
 * Pure. Deep-copies `items` (JSON clone — all fields here are plain data) into a timestamped
 * snapshot. Taken BEFORE any mutation, so a bad archive decision is one restore away.
 */
export function buildSnapshot(items, { now, reason = 'pre-archive snapshot' } = {}) {
  if (now == null) throw new Error('buildSnapshot: `now` must be provided (injected clock)');
  return {
    takenAt: now,
    reason,
    items: (items ?? []).map((i) => JSON.parse(JSON.stringify(i))),
  };
}

/**
 * Pure. Reverses buildSnapshot: given a snapshot, return the items it captured. Malformed input
 * (missing/non-array `items`) is reported as `ok: false` rather than silently returning an empty
 * restore that LOOKS like it worked.
 */
export function restoreFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return { ok: false, error: 'snapshot missing or malformed — no `items` array', items: [], takenAt: null };
  }
  return {
    ok: true,
    items: snapshot.items.map((i) => JSON.parse(JSON.stringify(i))),
    takenAt: snapshot.takenAt ?? null,
  };
}

// ---- Ledger (pure) — the archive record for DB-backed items, and the archive log for all kinds ---

/**
 * Pure. Append archival entries for `proposals` to `ledger`. Idempotent: an item already
 * (non-restored) archived is skipped rather than double-recorded.
 */
export function applyArchival(ledger, proposals, { now, confirmedBy = 'unknown' } = {}) {
  if (now == null) throw new Error('applyArchival: `now` must be provided (injected clock)');
  const list = Array.isArray(ledger) ? ledger : [];
  const existing = new Set(list.filter((e) => !e.restoredAt).map((e) => `${e.kind}:${e.id}`));
  const additions = [];
  for (const p of proposals ?? []) {
    const key = `${p.item.kind}:${p.item.id}`;
    if (existing.has(key)) continue;
    additions.push({
      kind: p.item.kind,
      id: p.item.id,
      title: p.item.title,
      reason: p.reason,
      archivedAt: now,
      confirmedBy,
      restoredAt: null,
    });
  }
  return [...list, ...additions];
}

/**
 * Pure. Mark ledger entries for `keys` (array of "kind:id" strings or {kind,id} objects) as
 * restored. Restore is "mark restored", never delete — the archival fact itself stays auditable.
 */
export function applyRestore(ledger, keys, { now } = {}) {
  if (now == null) throw new Error('applyRestore: `now` must be provided (injected clock)');
  const keySet = new Set((keys ?? []).map((k) => (typeof k === 'string' ? k : `${k.kind}:${k.id}`)));
  return (Array.isArray(ledger) ? ledger : []).map((e) => {
    const key = `${e.kind}:${e.id}`;
    return keySet.has(key) && !e.restoredAt ? { ...e, restoredAt: now } : e;
  });
}

/** Pure. The set of "kind:id" keys currently archived (not restored) in a ledger. */
export function listArchivedKeys(ledger) {
  return new Set((Array.isArray(ledger) ? ledger : []).filter((e) => !e.restoredAt).map((e) => `${e.kind}:${e.id}`));
}

// ---- Steering-rules section extraction (pure text op) ------------------------------

/** Pure. Pull the `## Steering Rules` section out of a constraints.md's full text (heading to the
 *  next `## ` heading, or end of file). Returns '' if the heading is absent. */
export function extractSteeringSection(fullText) {
  const text = String(fullText ?? '');
  const idx = text.indexOf('## Steering Rules');
  if (idx === -1) return '';
  const rest = text.slice(idx);
  const afterHeading = rest.slice('## Steering Rules'.length);
  const nextHeading = afterHeading.search(/\n## /);
  return nextHeading === -1 ? rest : rest.slice(0, '## Steering Rules'.length + nextHeading);
}

// ---- I/O --------------------------------------------------------------------------

const API = () => process.env.VLDR_API_URL || 'http://localhost:3141';
const PROJECT = (argv) => {
  const i = argv.indexOf('--project');
  return i >= 0 ? argv[i + 1] : (process.env.VLDR_PROJECT_ID || 'volundr-meta');
};
const arg = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

function vldrHome() {
  return process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
}
function retireDir(home, projectId) {
  return path.join(home, 'projects', projectId, 'memory-retire');
}
function ledgerFilePath(home, projectId) {
  return path.join(retireDir(home, projectId), 'ledger.json');
}
function stateFilePath(home, projectId) {
  return path.join(retireDir(home, projectId), 'state.json');
}
function snapshotDirPath(home, projectId) {
  return path.join(retireDir(home, projectId), 'snapshots');
}
function snapshotFilePath(home, projectId, now) {
  return path.join(snapshotDirPath(home, projectId), `${String(now).replace(/[:.]/g, '-')}.json`);
}
function patternsDirPath(home) {
  return path.join(home, 'global', 'patterns');
}
function archivedPatternsDirPath(home) {
  return path.join(patternsDirPath(home), '.archived');
}

async function readJsonFile(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}
async function fetchLessons(projectId) {
  return fetchJson(`${API()}/api/projects/${projectId}/lessons`);
}
async function fetchCards(projectId) {
  return fetchJson(`${API()}/api/projects/${projectId}/cards`);
}
async function fetchSkills() {
  return fetchJson(`${API()}/api/skills`);
}

async function readPatternFiles(home) {
  const dir = patternsDirPath(home);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const files = entries.filter((f) => f.toLowerCase().endsWith('.md'));
  const out = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(dir, f), 'utf8');
    out.push({ filename: f, content });
  }
  return out;
}

async function readSteeringRulesText(home, projectId) {
  const p = path.join(home, 'projects', projectId, 'constraints.md');
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
  return extractSteeringSection(text);
}

async function archivePatternFile(home, filename) {
  await fs.mkdir(archivedPatternsDirPath(home), { recursive: true });
  await fs.rename(path.join(patternsDirPath(home), filename), path.join(archivedPatternsDirPath(home), filename));
}
async function unarchivePatternFile(home, filename) {
  await fs.rename(path.join(archivedPatternsDirPath(home), filename), path.join(patternsDirPath(home), filename));
}

async function latestSnapshotPath(home, projectId) {
  const dir = snapshotDirPath(home, projectId);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function runRestore(argv, { projectId, home, now }) {
  const given = arg(argv, '--restore');
  const snapPath = given ? given : await latestSnapshotPath(home, projectId);
  if (!snapPath) {
    process.stderr.write('[memory-retire] no snapshot found to restore from.\n');
    process.exitCode = 1;
    return;
  }
  let snapshot;
  try {
    snapshot = await readJsonFile(snapPath, null);
    if (!snapshot) throw new Error('file not found');
  } catch (e) {
    process.stderr.write(`[memory-retire] cannot read snapshot ${snapPath}: ${e.message}\n`);
    process.exitCode = 2;
    return;
  }
  const restored = restoreFromSnapshot(snapshot);
  if (!restored.ok) {
    process.stderr.write(`[memory-retire] ${restored.error}\n`);
    process.exitCode = 1;
    return;
  }
  const ledger = await readJsonFile(ledgerFilePath(home, projectId), []);
  const newLedger = applyRestore(ledger, restored.items, { now });
  try {
    await writeJsonFile(ledgerFilePath(home, projectId), newLedger);
  } catch (e) {
    process.stderr.write(`[memory-retire] FAILED to write ledger during restore: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  for (const item of restored.items) {
    if (item.kind === 'pattern' && item.raw?.filename) {
      try {
        await unarchivePatternFile(home, item.raw.filename);
      } catch (e) {
        process.stderr.write(`[memory-retire] WARN could not move pattern file back (${item.raw.filename}): ${e.message}\n`);
      }
    }
  }
  process.stdout.write(`[memory-retire] restored ${restored.items.length} item(s) from ${snapPath} (taken ${restored.takenAt}).\n`);
  process.exitCode = 0;
}

async function main(argv) {
  const projectId = PROJECT(argv);
  const home = vldrHome();
  const now = new Date().toISOString();

  if (argv.includes('--restore')) {
    await runRestore(argv, { projectId, home, now });
    return;
  }

  const jsonOut = argv.includes('--json');
  const force = argv.includes('--force');

  const failures = [];
  let lessonsRaw = [], cardsRaw = [], skillsRaw = [], patternFiles = [], steeringText = '';
  try { lessonsRaw = await fetchLessons(projectId); } catch (e) { failures.push(`lessons: ${e.message}`); }
  try { cardsRaw = await fetchCards(projectId); } catch (e) { failures.push(`cards: ${e.message}`); }
  try { skillsRaw = await fetchSkills(); } catch (e) { failures.push(`skills: ${e.message}`); }
  try { patternFiles = await readPatternFiles(home); } catch (e) { failures.push(`patterns: ${e.message}`); }
  try { steeringText = await readSteeringRulesText(home, projectId); } catch (e) { failures.push(`constraints.md: ${e.message}`); }

  if (failures.length) {
    process.stdout.write(`[memory-retire] UNKNOWN — ${failures.length} store(s) could not be read: ${failures.join('; ')}\n`);
    process.stdout.write('[memory-retire] This is NOT "nothing to retire". Re-run once the store(s) above are reachable.\n');
    process.exitCode = 2;
    return;
  }

  const items = [
    ...lessonsRaw.map(normalizeLesson),
    ...skillsRaw.map(normalizeSkill),
    ...patternFiles.map(({ filename, content }) => normalizePattern(filename, content)),
  ];

  const ledger = await readJsonFile(ledgerFilePath(home, projectId), []);
  const state = await readJsonFile(stateFilePath(home, projectId), {});
  const archivedKeys = listArchivedKeys(ledger);
  const candidateItems = items.filter((i) => !archivedKeys.has(itemKey(i)));

  const result = proposeRetirement({
    items: candidateItems,
    now,
    steeringRulesText: steeringText,
    cards: cardsRaw,
    lastRunAt: state.lastRunAt ?? null,
    force,
  });

  if (!result.ran) {
    process.stdout.write(formatProposalReport(result) + '\n');
    process.exitCode = 0;
    return;
  }

  await writeJsonFile(stateFilePath(home, projectId), { ...state, lastRunAt: now });

  if (jsonOut) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(formatProposalReport(result) + '\n');
  }

  if (argv.includes('--confirm')) {
    if (!argv.includes('--yes')) {
      process.stdout.write('\n[memory-retire] --confirm requires --yes as an explicit acknowledgement. Nothing was archived.\n');
      process.exitCode = 0;
      return;
    }
    if (result.proposals.length === 0) {
      process.stdout.write('\n[memory-retire] nothing proposed — nothing to confirm.\n');
      process.exitCode = 0;
      return;
    }
    const snapshot = buildSnapshot(result.proposals.map((p) => p.item), {
      now,
      reason: `pre-archive snapshot for ${result.proposals.length} item(s)`,
    });
    const snapPath = snapshotFilePath(home, projectId, now);
    try {
      await writeJsonFile(snapPath, snapshot);
    } catch (e) {
      process.stderr.write(`[memory-retire] FAILED to write snapshot — aborting, nothing archived: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }
    const newLedger = applyArchival(ledger, result.proposals, {
      now,
      confirmedBy: process.env.USER || process.env.USERNAME || 'unknown',
    });
    try {
      await writeJsonFile(ledgerFilePath(home, projectId), newLedger);
    } catch (e) {
      process.stderr.write(
        `[memory-retire] FAILED to write ledger after snapshot at ${snapPath} — archive NOT fully applied, `
        + `but the snapshot exists for manual recovery: ${e.message}\n`,
      );
      process.exitCode = 1;
      return;
    }
    for (const p of result.proposals) {
      if (p.item.kind === 'pattern' && p.item.raw?.filename) {
        try {
          await archivePatternFile(home, p.item.raw.filename);
        } catch (e) {
          process.stderr.write(`[memory-retire] WARN could not move pattern file (${p.item.raw.filename}): ${e.message} (ledger entry still recorded)\n`);
        }
      }
    }
    process.stdout.write(`\n[memory-retire] archived ${result.proposals.length} item(s). Snapshot: ${snapPath}\n`);
  }

  process.exitCode = 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
