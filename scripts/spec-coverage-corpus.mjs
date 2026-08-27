#!/usr/bin/env node
/**
 * spec-coverage-corpus.mjs — measure drift-detector behaviour over a REAL card corpus.
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT. FRW-BL-118's ISC-4 required a before/after finding count
 * over real data. That measurement was done — and done in an ad-hoc shell command that was never
 * committed, so the blind reviewer could not reproduce it and correctly failed the criterion. It
 * was the third time in one session that a real verification was not made reproducible. A check
 * that lives only in a transcript is not evidence; this file is the fix for that habit, not just
 * for that criterion.
 *
 * WHAT THE REVIEWER SAW, and why it looked like a contradiction. Running the analyzer's own CLI
 * (`spec-coverage.mjs --project clear`) reports "0 requirements, 0 glossary terms, 0 findings",
 * because that path reads card FILES from VLDR_HOME (clear has 6) and a blueprint with no
 * `## Glossary` section. The 120 figure is the number of CARD ROWS in the dashboard DB, which is
 * the framework's actual source of truth for cards — files are traceability artifacts. Both numbers
 * are correct about different things, and the original claim said "real cards" without saying
 * which. This script says which, in code.
 *
 * WHAT IT CAN AND CANNOT SHOW. The CORPUS is real prose. The GLOSSARY is a test parameter: no real
 * blueprint carries a `## Glossary` yet (the convention is new to FRW-BL-099), and authoring one
 * into a live project's spec to satisfy a criterion would be the tail wagging the dog — the same
 * call FRW-BL-099 ISC-7 made. So this proves "no true positives lost over real prose". It cannot
 * prove "false positives removed", because a corpus with no meta-references contains none to
 * remove. That limitation is the point of stating it rather than reporting a bare pass.
 *
 * Requires a running dashboard (default http://localhost:3141).
 *
 * Usage:
 *   node scripts/spec-coverage-corpus.mjs --project clear
 *   node scripts/spec-coverage-corpus.mjs --project clear --show 20
 *   node scripts/spec-coverage-corpus.mjs --project clear --json
 *
 * Exit: 0 = measured (whatever the numbers). 1 = could not read the corpus. Deliberately distinct:
 * "no corpus" must never print as "no findings", which is the FRW-BL-099 lesson applied to itself.
 */

import { detectDrift, cardText } from './spec-coverage.mjs';

const API = process.env.VLDR_API_URL || 'http://localhost:3141';

/**
 * The probe glossary. Terms chosen because clear's real cards genuinely use both sides — a glossary
 * of words nobody writes would measure nothing. Kept in code so a rerun is byte-identical.
 */
export const PROBE_GLOSSARY = [
  { canonical: 'assessment', variants: ['audit', 'review'] },
  { canonical: 'landing zone', variants: ['landingzone', 'LZ'] },
  { canonical: 'finding', variants: ['issue', 'problem'] },
];

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (t) => new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(t)}(?![A-Za-z0-9-])`, 'i');

/** PURE: what the detector reported BEFORE mention-awareness — a literal variant match. */
export function literalDrift(glossary, sources) {
  const out = [];
  for (const { name, text } of sources) {
    for (const term of glossary) {
      for (const v of term.variants) {
        if (wordRe(v).test(String(text ?? ''))) {
          out.push({ source: name, variant: v, canonical: term.canonical, text: String(text ?? '') });
        }
      }
    }
  }
  return out;
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const project = arg('--project', 'clear');
const show = Number(arg('--show', '8'));
const asJson = process.argv.includes('--json');

let cards;
try {
  const res = await fetch(`${API}/api/projects/${project}/cards`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  cards = await res.json();
  if (!Array.isArray(cards)) throw new Error('unexpected payload shape');
} catch (err) {
  console.error(`[spec-coverage-corpus] could not read cards for '${project}' from ${API}: ${err.message}`);
  console.error('[spec-coverage-corpus] this is NOT a clean result — the dashboard must be running.');
  process.exit(1);
}

const sources = cards.map((c) => ({ name: `card ${c.id}`, text: cardText(c) }));
const before = literalDrift(PROBE_GLOSSARY, sources);
const after = detectDrift(PROBE_GLOSSARY, sources);

const afterKeys = new Set(after.map((f) => `${f.source}|${f.detail}`));
const suppressed = before.filter(
  (b) => !afterKeys.has(`${b.source}|uses "${b.variant}" where the glossary defines "${b.canonical}"`),
);

if (asJson) {
  console.log(JSON.stringify({
    project, cards: cards.length, before: before.length, after: after.length,
    suppressed: suppressed.map((s) => ({ source: s.source, variant: s.variant, canonical: s.canonical })),
  }, null, 2));
} else {
  console.log(`corpus: ${cards.length} card rows from project '${project}' (dashboard DB, not card files)`);
  console.log(`  BEFORE (literal variant match) : ${before.length} findings`);
  console.log(`  AFTER  (mention-aware)         : ${after.length} findings`);
  console.log(`  suppressed                     : ${suppressed.length}`);
  if (suppressed.length) {
    console.log('\n  SUPPRESSED — each must read as prose ABOUT the term, not as drift.');
    console.log('  INSPECT THESE. A count alone hides the failure this check exists to catch:');
    console.log('  the first version of the detector suppressed exactly one item here, and that');
    console.log('  one item was a TRUE POSITIVE lost, not a false positive removed.');
    for (const s of suppressed.slice(0, show)) {
      const i = s.text.search(wordRe(s.variant));
      const snippet = s.text.slice(Math.max(0, i - 75), i + 75).replace(/\s+/g, ' ');
      console.log(`    [${s.variant} -> ${s.canonical}] ${s.source}: ...${snippet}...`);
    }
  }
  if (after.length) {
    console.log('\n  RETAINED (sample) — each must read as genuine drift:');
    for (const f of after.slice(0, Math.min(show, 6))) console.log(`    ${f.source}: ${f.detail}`);
  }
}
