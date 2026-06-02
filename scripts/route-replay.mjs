#!/usr/bin/env node
/**
 * route-replay.mjs — Persona routing replay harness (FRW-BL-024, ISC-1)
 *
 * Runs the CURRENT routing rules against an arbitrary card description and prints
 * the matched rule + score + verdict. Imports the SAME production scorer the API
 * uses (dashboard/packages/api/dist/lib/auto-routing.js) so the harness can never
 * drift from live routing.
 *
 * PREREQUISITE: build the api package first so dist exists:
 *     npx turbo build --filter=@vldr/api      (or: cd dashboard/packages/api && npm run build)
 *
 * USAGE:
 *     node scripts/route-replay.mjs "Implement the GitHub clone backend via Octokit"
 *     node scripts/route-replay.mjs --suite          # replay the committed fixture set
 *     node scripts/route-replay.mjs --rules <path>   # use an alternate rules JSON
 *
 * Rules source defaults to framework/routing-rules/seed.json (commit-pinned).
 * Pass --db to read the live dashboard DB instead (requires better-sqlite3 + DB path).
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const PROD = resolve(REPO, 'dashboard/packages/api/dist/lib/auto-routing.js');
let autoRouteFromRows;
try {
  ({ autoRouteFromRows } = await import(pathToUrl(PROD)));
} catch (e) {
  console.error(`Could not import the production scorer at:\n  ${PROD}\n` +
    `Build it first:  npx turbo build --filter=@vldr/api\n\n(${e.message})`);
  process.exit(1);
}

function pathToUrl(p) {
  return 'file://' + (p.startsWith('/') ? p : '/' + p.replace(/\\/g, '/'));
}

function loadRules(rulesPath) {
  const seed = JSON.parse(readFileSync(rulesPath, 'utf8'));
  return seed.map((r, i) => ({
    id: i + 1,
    work_type: r.workType,
    persona_id: r.personaId,
    examples: r.examples ? JSON.stringify(r.examples) : null,
    negative_keywords: r.negativeKeywords ? JSON.stringify(r.negativeKeywords) : null,
    confidence: r.confidence ?? 'medium',
    module_pattern: r.modulePattern ?? null,
    priority: r.priority ?? 0,
  }));
}

// --- arg parsing ---
const argv = process.argv.slice(2);
const rulesIdx = argv.indexOf('--rules');
const rulesPath = rulesIdx >= 0 ? argv[rulesIdx + 1] : resolve(REPO, 'framework/routing-rules/seed.json');
const rows = loadRules(rulesPath);

if (argv.includes('--suite')) {
  const fx = JSON.parse(readFileSync(
    resolve(REPO, 'dashboard/packages/api/src/lib/__fixtures__/routing-cards.json'), 'utf8'));
  let pass = 0, fail = 0;
  console.log('── Mis-routed cards (expect: in acceptable set, not previous wrong pick) ──');
  for (const c of fx.misRouted) {
    const { personaId, reason } = autoRouteFromRows(rows, { description: c.description });
    const ok = c.accept.includes(personaId) && personaId !== c.previousWrongPick;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(13)} -> ${String(personaId).padEnd(20)} (was ${c.previousWrongPick})`);
    console.log(`        ${reason}`);
  }
  console.log('── Strong-signal foundation (expect: unchanged) ──');
  for (const c of fx.strongFoundation) {
    const { personaId } = autoRouteFromRows(rows, { description: c.description });
    const ok = personaId === c.expect;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(13)} -> ${String(personaId).padEnd(20)} (expect ${c.expect})`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

const description = argv.filter((a) => !a.startsWith('--') && a !== rulesPath).join(' ').trim();
if (!description) {
  console.error('Provide a card description, or --suite. See header for usage.');
  process.exit(2);
}

const result = autoRouteFromRows(rows, { description });
console.log(`description: ${description}`);
console.log(`verdict:     ${result.personaId ?? '(no match)'}`);
console.log(`confidence:  ${result.confidence ?? '-'}`);
console.log(`reason:      ${result.reason ?? '-'}`);
