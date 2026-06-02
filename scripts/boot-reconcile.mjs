#!/usr/bin/env node
/**
 * boot-reconcile.mjs — surface un-journaled work on boot (FRW-BL-054)
 *
 * Volundr captures state on the way OUT (PreCompact, shutdown). It does NOT, by default,
 * reconcile on the way IN. A crashed / alt-F4'd / OOM'd session can leave commits on disk
 * that were never journaled — silent state loss on the next boot. This script diffs the
 * last journal/checkpoint anchor against `git log` (and the session transcript mtime) and
 * surfaces any work that happened AFTER the last reconciliation point, so the operator (or
 * Volundr's boot Step 7b) can re-journal it instead of losing the context.
 *
 * Complements — does not replace — the DB recovery protocol (vldr.project.get +
 * vldr.cards.list). The DB knows card STATUS; this knows whether recent commits were
 * narrated into the journal.
 *
 * USAGE:
 *   node scripts/boot-reconcile.mjs [<projectId>] [--repo <path>] [--transcript <path>]
 *   (projectId also read from $VLDR_PROJECT_ID; repo defaults to cwd; API from $VLDR_API_URL)
 * EXIT: always 0 — this is an advisory boot aid, never a gate.
 */

import { execFileSync } from 'child_process';
import { statSync } from 'fs';
import { fileURLToPath } from 'url';

// --- pure core (unit-tested) ----------------------------------------------

/** Normalize a DB-style timestamp to a UTC ISO string. SQLite CURRENT_TIMESTAMP is UTC but
 *  emits "YYYY-MM-DD HH:MM:SS" with no TZ marker; Date.parse would (wrongly) read that as LOCAL.
 *  Already-ISO strings (with a 'T', and possibly an offset/Z) are returned unchanged. */
export function toIsoUtc(ts) {
  if (!ts) return null;
  if (/^\d{4}-\d\d-\d\dT/.test(ts)) return ts;
  const m = /^(\d{4}-\d\d-\d\d)[ ](\d\d:\d\d:\d\d)/.exec(ts);
  return m ? `${m[1]}T${m[2]}Z` : ts;
}

/** Choose the most-recent anchor between the last journal entry and last checkpoint tag. */
export function pickAnchorIso(lastJournalIso, lastCheckpointIso) {
  const j = lastJournalIso ? Date.parse(lastJournalIso) : NaN;
  const c = lastCheckpointIso ? Date.parse(lastCheckpointIso) : NaN;
  if (Number.isNaN(j) && Number.isNaN(c)) return null;
  if (Number.isNaN(j)) return lastCheckpointIso;
  if (Number.isNaN(c)) return lastJournalIso;
  return j >= c ? lastJournalIso : lastCheckpointIso;
}

/** Commits strictly AFTER the anchor ISO = candidate un-journaled work.
 *  commits: [{ hash, iso, subject }]. No anchor → treat all as unreconciled. */
export function findUnJournaledCommits(anchorIso, commits) {
  const list = Array.isArray(commits) ? commits : [];
  const anchor = anchorIso ? Date.parse(anchorIso) : NaN;
  if (Number.isNaN(anchor)) return list.slice();
  return list.filter((c) => {
    const t = Date.parse(c && c.iso);
    return !Number.isNaN(t) && t > anchor;
  });
}

/** Did the session transcript change after the anchor? (activity that may be un-journaled) */
export function transcriptTouchedAfter(anchorIso, transcriptMtimeMs) {
  if (!transcriptMtimeMs || !anchorIso) return false;
  const anchor = Date.parse(anchorIso);
  return !Number.isNaN(anchor) && transcriptMtimeMs > anchor;
}

/** Build the operator-facing reconciliation summary (pure, from gathered inputs). */
export function buildReconcileReport({ anchorIso, unJournaled, transcriptTouched }) {
  if ((!unJournaled || unJournaled.length === 0) && !transcriptTouched) {
    return { clean: true, text: `[boot-reconcile] No un-journaled work since ${anchorIso || '(no anchor)'} — state is reconciled.` };
  }
  const lines = [`[boot-reconcile] Possible un-journaled work since ${anchorIso || '(no prior anchor)'}:`];
  for (const c of unJournaled || []) lines.push(`  • ${String(c.hash || '').slice(0, 9)} ${c.iso}  ${c.subject || ''}`);
  if (transcriptTouched) lines.push('  • session transcript was modified after the last journal entry (prior session may have ended without a shutdown/journal).');
  lines.push('  → Re-journal these (vldr.journal.log) or confirm they are already captured before resuming.');
  return { clean: false, text: lines.join('\n') };
}

// --- CLI (impure: API + git + fs) ------------------------------------------

function parseArgs(argv) {
  const out = { projectId: process.env.VLDR_PROJECT_ID || null, repo: process.cwd(), transcript: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') out.repo = argv[++i];
    else if (argv[i] === '--transcript') out.transcript = argv[++i];
    else if (!argv[i].startsWith('--') && !out.projectId) out.projectId = argv[i];
  }
  return out;
}

function gitCommitsSince(repo, sinceIso) {
  try {
    const args = ['-C', repo, 'log', '--pretty=%H|%cI|%s', '-n', '50'];
    if (sinceIso) args.push(`--since=${sinceIso}`);
    const out = execFileSync('git', args, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).map((l) => {
      const [hash, iso, ...rest] = l.split('|');
      return { hash, iso, subject: rest.join('|') };
    });
  } catch { return []; }
}

async function main() {
  const { projectId, repo, transcript } = parseArgs(process.argv);
  const apiUrl = process.env.VLDR_API_URL || 'http://localhost:3141';
  let lastJournalIso = null;
  if (projectId) {
    try {
      const res = await fetch(`${apiUrl}/api/projects/${projectId}/journal?limit=1`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) { const rows = await res.json(); lastJournalIso = toIsoUtc(rows && rows[0] && (rows[0].timestamp || rows[0].createdAt) || null); }
    } catch { /* dashboard offline — git log is still useful */ }
  }
  let lastCheckpointIso = null;
  try {
    const tag = execFileSync('git', ['-C', repo, 'tag', '--list', 'checkpoint-*', '--sort=-creatordate'], { encoding: 'utf8' }).trim().split('\n')[0];
    if (tag) lastCheckpointIso = toIsoUtc(execFileSync('git', ['-C', repo, 'log', '-1', '--format=%cI', tag], { encoding: 'utf8' }).trim());
  } catch { /* no checkpoint tags */ }

  const anchorIso = pickAnchorIso(lastJournalIso, lastCheckpointIso);
  const commits = gitCommitsSince(repo, anchorIso);
  const unJournaled = findUnJournaledCommits(anchorIso, commits);
  let transcriptTouched = false;
  if (transcript) { try { transcriptTouched = transcriptTouchedAfter(anchorIso, statSync(transcript).mtimeMs); } catch { /* ignore */ } }

  process.stdout.write(buildReconcileReport({ anchorIso, unJournaled, transcriptTouched }).text + '\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
