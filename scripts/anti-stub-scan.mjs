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
  return files.filter((f) => CODE_EXT.test(f) && existsSync(f));
}

function main() {
  const files = resolveFiles(process.argv.slice(2));
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
  if (blocks.length > 0) {
    console.log('FAIL: block-severity stubs present — card must not reach blind review with these.');
    process.exit(2);
  }
  console.log(warns.length > 0 ? 'PASS (with warnings — reviewer should confirm).' : 'PASS (clean).');
  process.exit(0);
}

// Only run main() when invoked directly (tests import the helpers).
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
