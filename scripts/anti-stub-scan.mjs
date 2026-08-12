#!/usr/bin/env node
/**
 * anti-stub-scan.mjs — deterministic stub/mock/TODO gate (FRW-BL-044)
 *
 * Catches the common agent failure of shipping stubbed/mocked/TODO/NotImplemented
 * code that passes shallow checks. Runs in the build gate BEFORE blind review so a
 * card never reaches the reviewer (or `done`) with placeholder implementations.
 *
 * Scans NON-TEST changed files only — test files legitimately contain mocks/stubs.
 *
 * USAGE:
 *   node scripts/anti-stub-scan.mjs <file> [<file> ...]   # explicit files
 *   node scripts/anti-stub-scan.mjs --staged              # git staged files (ACM)
 *   node scripts/anti-stub-scan.mjs --diff <range>        # files changed in a git range
 *
 * EXIT: 2 if any BLOCK-severity finding, else 0. WARN findings are printed but do
 * not fail the gate (they flag the card for reviewer attention).
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

// --- pattern table: [regex, severity, label] -------------------------------
// BLOCK = a clear unfinished implementation; WARN = needs reviewer attention.
const PATTERNS = [
  // BLOCK: actual unfinished-code constructs (low false-positive — these are code, not prose).
  // The throw/panic patterns must precede the bare-prose WARN rules so a real
  // `throw new Error('not implemented')` is labelled block, not warn.
  [/\bNotImplementedError\b/, 'block', 'NotImplementedError'],
  [/\bNotImplementedException\b/, 'block', 'NotImplementedException'],
  [/\braise\s+NotImplementedError\b/, 'block', 'raise NotImplementedError'],
  [/throw\s+new\s+Error\(\s*['"`][^'"`]*\b(not\s*impl|unimplemented|stub|placeholder|todo|coming soon)/i, 'block', 'throw new Error(...stub...)'],
  [/panic\(\s*["`][^"`]*not\s*impl/i, 'block', 'panic("not implemented")'],
  // WARN: words/prose that legitimately appear in real code, comments, and docs
  // (e.g. a stub-detector's own output strings) — flag for reviewer, never hard-block.
  [/\bnot\s+implemented\b/i, 'warn', 'not implemented (prose)'],
  [/\bunimplemented\b/i, 'warn', 'unimplemented (prose)'],
  [/\bcoming\s+soon\b/i, 'warn', 'coming soon'],
  [/\bTODO\b/, 'warn', 'TODO'],
  [/\bFIXME\b/, 'warn', 'FIXME'],
  [/\bXXX\b/, 'warn', 'XXX'],
  [/\bHACK\b/, 'warn', 'HACK'],
  [/\bstub\b/i, 'warn', 'stub'],
  [/\bmock\b/i, 'warn', 'mock'],
  [/\bfake\b/i, 'warn', 'fake'],
  [/\bplaceholder\b/i, 'warn', 'placeholder'],
];

const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|fixtures?|spec)\//i;
const TEST_FILE = /\.(test|spec|stories)\.[a-z]+$/i;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|java|rb|php|rs|vue|svelte)$/i;

export function isTestFile(path) {
  const p = path.replace(/\\/g, '/');
  return TEST_PATH.test(p) || TEST_FILE.test(p);
}

/**
 * Pure scanner. `readFile(path) -> string`. Returns findings; skips test files.
 */
export function scanForStubs(files, readFile) {
  const findings = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    let src;
    try { src = readFile(file); } catch { continue; }
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [re, severity, label] of PATTERNS) {
        if (re.test(line)) {
          findings.push({ file, line: i + 1, severity, label, text: line.trim().slice(0, 100) });
          break; // one finding per line is enough
        }
      }
    }
  }
  return findings;
}

/**
 * FRW-BL-103: the scanner cannot scan ITSELF. Its pattern table contains the literal strings it
 * blocks on (`NotImplementedError`, `panic("not impl`, ...), so any commit touching this file scored
 * 5 BLOCKs against its own pattern definitions and exited 2 — the tool was unmodifiable. Found by
 * staging a change to this very file. Same FRW-BL-090 shape as ever: a definition of a forbidden
 * thing read as the forbidden thing.
 *
 * Narrow by design — ONLY this script and its test, matched on basename so it works for both
 * relative and absolute paths. Exported so the exclusion is testable rather than an inline regex,
 * and the caller PRINTS what it skipped: a silent exclusion is a hole.
 */
export function isOwnSource(path) {
  return /(^|[\\/])anti-stub-scan(\.test)?\.mjs$/.test(String(path ?? ''));
}

/**
 * Split `--card <id>` out of argv, leaving the flags resolveFiles understands.
 *
 * The guard on `cardIdx >= 0` is load-bearing and was a real bug: with no `--card`, cardIdx is -1,
 * so a filter of `i !== cardIdx + 1` reduces to `i !== 0` and silently ate argv[0] — meaning a bare
 * `--staged` scanned nothing and exited 0. That is the exact silent-green failure the --staged flag
 * exists to prevent, reintroduced by the change that added event emission for it.
 */
export function splitCardArg(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const cardIdx = list.indexOf('--card');
  if (cardIdx < 0) return { cardId: null, rest: [...list] };
  return {
    cardId: list[cardIdx + 1] ?? null,
    rest: list.filter((_, i) => i !== cardIdx && i !== cardIdx + 1),
  };
}

// --- CLI --------------------------------------------------------------------
function resolveFiles(argv) {
  const stagedIdx = argv.indexOf('--staged');
  const diffIdx = argv.indexOf('--diff');
  let files;
  if (stagedIdx >= 0) {
    files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } else if (diffIdx >= 0) {
    const range = argv[diffIdx + 1];
    files = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACM', range], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } else {
    files = argv.filter((a) => !a.startsWith('--'));
  }
  const kept = files.filter((f) => CODE_EXT.test(f) && existsSync(f));
  const self = kept.filter(isOwnSource);
  if (self.length > 0) {
    console.log(`anti-stub-scan: skipping own source (${self.join(', ')}) — its pattern table `
      + 'contains the strings it detects; scanning itself yields only self-matches.');
  }
  return kept.filter((f) => !isOwnSource(f));
}

/**
 * FRW-BL-103: leave a TRACE so the §4b ordering requirement ("anti-stub scan before blind review")
 * is mechanically checkable instead of a request to remember. Without an event there is nothing for
 * scripts/procedural-order.mjs to compare against a reviewer's spawn time — which is precisely why
 * a real session ran the scan AFTER the reviewers and nothing noticed.
 *
 * Fire-and-forget, and deliberately non-fatal: this script's value is the scan, and a dashboard that
 * is down must never fail a gate. No new dependency — Node's built-in fetch, same pattern the hooks
 * use. Opt-in via `--card <ID>`, so the script stays pure for every other caller.
 */
async function emitScanEvent(cardId, files, blocks, warns) {
  if (!cardId) return;
  const api = process.env.VLDR_API_URL || 'http://localhost:3141';
  const projectId = process.env.VLDR_PROJECT_ID;
  if (!projectId) {
    console.log('anti-stub-scan: --card given but VLDR_PROJECT_ID unset; no ordering event emitted.');
    return;
  }
  try {
    await fetch(`${api}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        cardId,
        type: 'anti_stub_scan',
        detail: `anti-stub scan: ${blocks} block, ${warns} warn across ${files} non-test file(s)`,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.log('anti-stub-scan: ordering event not recorded (dashboard unreachable) — scan result stands.');
  }
}

function main() {
  const { cardId, rest } = splitCardArg(process.argv.slice(2));
  const files = resolveFiles(rest);
  if (files.length === 0) {
    console.log('anti-stub-scan: no code files to scan.');
    process.exit(0);
  }
  const findings = scanForStubs(files, (p) => readFileSync(p, 'utf8'));
  const blocks = findings.filter((f) => f.severity === 'block');
  const warns = findings.filter((f) => f.severity === 'warn');

  for (const f of findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.file}:${f.line}  ${f.label}  | ${f.text}`);
  }
  console.log(`\nanti-stub-scan: ${blocks.length} block, ${warns.length} warn across ${files.length} non-test file(s).`);

  // Record the trace BEFORE exiting, including on the failure path: a scan that found blocks is
  // still a scan that ran, and the ordering claim is about when it ran, not whether it passed.
  const finish = (code, msg) => {
    if (msg) console.log(msg);
    process.exit(code);
  };
  emitScanEvent(cardId, files.length, blocks.length, warns.length).then(() => {
    if (blocks.length > 0) {
      finish(2, 'FAIL: block-severity stubs present — card must not reach blind review with these.');
    }
    finish(0, warns.length > 0 ? 'PASS (with warnings — reviewer should confirm).' : 'PASS (clean).');
  });
}

// Only run main() when invoked directly (tests import the helpers).
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
