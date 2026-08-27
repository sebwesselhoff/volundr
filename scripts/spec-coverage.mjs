#!/usr/bin/env node
/**
 * spec-coverage.mjs — does the card set actually cover the blueprint? (FRW-BL-099)
 *
 * Volundr validates each card against its own ISC and spotchecks cross-branch consistency. Nothing
 * checks the level above: that the blueprint's REQUIREMENTS are covered by cards at all, or that the
 * words used in the blueprint still mean the same thing by the time they reach a card spec.
 * Round Table and Chaos Engine are qualitative debate, and they run once at blueprint time.
 *
 * So a requirement can be written, agreed, debated — and simply never turned into a card. Nothing
 * would say so. The failure is silent by construction: every individual card passes, the board goes
 * green, and the thing nobody built is invisible precisely because it has no card to be missing.
 *
 * DELIBERATELY LLM-FREE. A coverage report that is probabilistic cannot be a gate: it would fail
 * differently on reruns and nobody could tell a real gap from a bad sample. Everything here is
 * deterministic string and set work over injected inputs, so it can live in the gate suite.
 *
 * THE ID SCHEME IS THE INTERFACE, and it is why this card is sized L. The analyzer is simple; giving
 * requirements durable identifiers is the real work, because a coverage report that renumbers is
 * worse than no report — it would show churn where nothing changed and train people to ignore it.
 *
 *   FR-001   functional requirement
 *   NFR-001  non-functional requirement
 *   SC-001   success criterion
 *
 * The ID is the key. Prose around it may be rewritten freely; the identifier is what cards cite and
 * what this tool matches on. Never renumber, never reuse a retired id.
 *
 * USAGE
 *   node scripts/spec-coverage.mjs --project clear
 *   node scripts/spec-coverage.mjs --blueprint <path> --cards <json> [--constraints <path>] [--json]
 * EXIT: 0 = no findings, 1 = at least one CRITICAL, 2 = could not read the inputs (NOT "clean").
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

/** Requirement id shapes. Anchored so `FR-1` and `XFR-001` do not match. */
export const REQUIREMENT_RE = /\b(FR|NFR|SC)-(\d{3})\b/g;

/**
 * Pure: pull requirements out of a blueprint.
 *
 * A requirement is DECLARED by a line that both carries an id and says something — the id alone is
 * a citation, not a declaration, which is what lets a card reference `FR-004` without the analyzer
 * thinking the card defines it.
 */
export function extractRequirements(src) {
  const out = [];
  const seen = new Map();
  const lines = String(src ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    // A declaration is `**FR-001** text` or `- FR-001: text` or `| FR-001 | text |` — the id near
    // the START of the line, followed by prose. A mention buried mid-sentence is a citation.
    const m = /^[\s|*\-#>]*\**\s*(FR|NFR|SC)-(\d{3})\**\s*[:|\-—]\s*(.+)$/.exec(line);
    if (!m) return;
    const id = `${m[1]}-${m[2]}`;
    const text = m[3].replace(/\|.*$/, '').replace(/\*+/g, '').trim();
    if (seen.has(id)) {
      out.push({ id, text, line: i + 1, duplicate: true, firstSeenLine: seen.get(id) });
      return;
    }
    seen.set(id, i + 1);
    out.push({ id, text, line: i + 1, duplicate: false });
  });
  return out;
}

/** Pure: every requirement id CITED anywhere in a blob (cards, SoWs). */
export function citedIds(text) {
  const out = new Set();
  const src = String(text ?? '');
  let m;
  const re = new RegExp(REQUIREMENT_RE.source, 'g');
  while ((m = re.exec(src))) out.add(`${m[1]}-${m[2]}`);
  return out;
}

/**
 * Pure: map requirements to the cards covering them.
 *
 * A card covers a requirement by CITING its id. That is deliberately mechanical: inferring coverage
 * from wording similarity is the probabilistic path this tool refuses, and it would produce exactly
 * the confident-but-wrong result that makes a gate untrustworthy.
 */
/**
 * PURE: the single definition of "this card's text".
 *
 * FRW-BL-117. There used to be two. `mapCoverage` joined id + title + description +
 * technicalNotes + criteria + isc, while the drift scan in `analyze()` joined only title +
 * description — so a forbidden glossary variant living in `technicalNotes` was scanned for
 * requirement citations and NOT scanned for drift, and the run reported clean over fields it had
 * never read. That is the exact silent-hole failure this module exists to eliminate, occurring
 * inside the module itself: its headline behaviour is to say "nothing to check" rather than "all
 * covered", and here it said clean rather than "not looked at".
 *
 * The fix is one helper rather than two corrected call sites, because the defect was never the
 * field list — it was two places independently deciding what a card's text is. With one function
 * they cannot drift apart again, which is the actual invariant worth holding.
 *
 * ISC CRITERIA ARE INCLUDED FOR COVERAGE AND EXCLUDED FROM DRIFT — a measured decision, not a
 * symmetry violation. The first version of this helper included them everywhere, arguing the
 * false-positive risk was speculative. FRW-BL-117's blind reviewer falsified that within minutes
 * with a legitimate criterion: "The analyzer rejects any card that still says audit instead of
 * assessment." That is correct prose about a glossary check, and it was reported as glossary drift.
 * Reproduced independently before acting on it.
 *
 * THE FIELD SET IS NOW UNCONDITIONAL AGAIN, and the round trip is worth recording because it is the
 * useful part. FRW-BL-117 briefly carried an `includeIsc: false` option that excluded ISC text from
 * drift scanning, after a reviewer demonstrated that a legitimate criterion ("...still says audit
 * instead of assessment") was reported as drift. Two things were wrong with that:
 *
 *   1. The stated reason — that ISC text is "disproportionately meta" — was not a discriminator.
 *      The identical sentence false-positived from `technicalNotes`, `criteria` and `description`
 *      too. Measured, all three.
 *   2. It treated the symptom. The real defect was that `detectDrift` could not tell a MENTION of a
 *      word from a USE of it, which no field list can fix.
 *
 * FRW-BL-118 fixed the actual defect (`isMetaReference`), so the workaround was removed rather than
 * left to ossify — the card that fixed the class carried a criterion requiring exactly that, so a
 * mitigation could not silently outlive the problem it mitigated. ISC text is scanned for both
 * coverage and drift again, and the meta-criterion that started this no longer fires.
 *
 * Keep it unconditional. One field list, one definition, no call site deciding for itself what a
 * card's text is — which was the original FRW-BL-117 defect and is the only invariant here that has
 * survived every revision.
 */
export function cardText(card) {
  if (!card || typeof card !== 'object') return '';
  return [
    card.id, card.title, card.description, card.technicalNotes, card.criteria,
    Array.isArray(card.isc) ? card.isc.map((c) => c && c.criterion).filter(Boolean).join(' ') : '',
  ].filter(Boolean).join('\n');
}

export function mapCoverage(requirements, cards) {
  const list = Array.isArray(cards) ? cards : [];
  const byRequirement = new Map();
  for (const card of list) {
    if (!card || typeof card !== 'object') continue;
    const blob = cardText(card);
    for (const id of citedIds(blob)) {
      if (!byRequirement.has(id)) byRequirement.set(id, []);
      byRequirement.get(id).push({ id: card.id, status: card.status });
    }
  }

  const covered = [];
  const uncovered = [];
  for (const req of requirements) {
    if (req.duplicate) continue;
    const cards2 = byRequirement.get(req.id) || [];
    if (cards2.length === 0) uncovered.push(req);
    else covered.push({ ...req, cards: cards2, done: cards2.filter((c) => c.status === 'done').length });
  }
  // A card citing an id the blueprint never declares is the reverse gap: work traceable to nothing.
  const orphanCitations = [...byRequirement.keys()]
    .filter((id) => !requirements.some((r) => r.id === id && !r.duplicate))
    .map((id) => ({ id, cards: byRequirement.get(id) }));

  return { covered, uncovered, orphanCitations };
}

/**
 * Pure: terminology drift, against a GLOSSARY rather than free-text diffing.
 *
 * Free-text diffing between documents produces noise proportional to their length, and noise is how
 * a check gets disabled. A glossary makes the question answerable: for each defined term, is a
 * FORBIDDEN VARIANT being used instead? That is checkable and quiet.
 *
 * Glossary format in the blueprint, under a `## Glossary` heading:
 *   - **canonical term** (not: variant one, variant two) — definition
 */
export function extractGlossary(src) {
  const terms = [];
  const lines = String(src ?? '').split(/\r?\n/);
  let inGlossary = false;
  for (const line of lines) {
    if (/^#{1,4}\s+glossary\b/i.test(line)) { inGlossary = true; continue; }
    if (inGlossary && /^#{1,4}\s+/.test(line)) break;
    if (!inGlossary) continue;
    const m = /^\s*[-*]\s*\**([^*(]+?)\**\s*\(not:\s*([^)]+)\)/i.exec(line);
    if (!m) continue;
    const canonical = m[1].trim();
    const variants = m[2].split(',').map((v) => v.trim()).filter(Boolean);
    if (canonical && variants.length) terms.push({ canonical, variants });
  }
  return terms;
}

const wordRe = (term) => new RegExp(`(^|[^A-Za-z0-9-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'i');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * PURE: is every occurrence of `variant` a MENTION of the word rather than a USE of it?
 *
 * FRW-BL-118. `detectDrift` matched forbidden variants literally, with no idea whether an
 * occurrence was use or mention, so correct prose ABOUT the glossary rule was reported as breaking
 * it. Demonstrated by FRW-BL-117's blind reviewer and reproduced from three separate fields:
 *
 *   "The analyzer rejects any card that still says audit instead of assessment."
 *   "Rename the audit field to assessment for glossary compliance."
 *
 * Both name the forbidden term because naming it is unavoidable when stating the rule. A gate that
 * fires on its own documentation trains people to switch it off — which is the failure this module
 * was built to prevent, so it is not acceptable to leave in place.
 *
 * WHY NOT `isNegatedOccurrence`, the existing precedent. It was checked first, and it does NOT
 * generalise: it looks for negation words ("do not X") in the preceding clause, and a terminology
 * correction contains no negation. "Rename the audit field to assessment" is affirmative. The two
 * need different SIGNALS — but the same SHAPE, which is copied deliberately: a short same-clause
 * window, all-or-nothing over occurrences, and an error direction chosen on purpose.
 *
 * THE SIGNAL, and the first version of it was WRONG. Proximity alone — "the canonical term appears
 * in the same clause" — looked right and passed every synthetic fixture. Measured against clear's
 * 120 real cards it removed ZERO false positives and lost ONE true positive: "assessment CSVs +
 * evidence catalog + audit plan" is a real use of "audit" that happened to sit near "assessment" in
 * a list. Net negative on real prose, which is exactly what ISC-4 exists to expose and what the
 * fixtures could not.
 *
 * So proximity is necessary but not sufficient. A mention also carries an explicit MARKER — the
 * grammar of correcting a word: "instead of", "rather than", "not:", "never", "rename X to Y",
 * "says", "the term", "spelled", "prefer X over Y", an arrow. A list that merely contains both nouns
 * has no marker and stays a finding. Quoting the variant is an independent marker.
 *
 * ERROR DIRECTION, chosen the same way `detectConstraintConflicts` chose its: any occurrence that is
 * a bare use makes the whole source a finding, so a card that discusses the rule in one sentence and
 * violates it in another is still caught. The residual error is false-NEGATIVE — drift that happens
 * to mention the canonical term nearby is missed. That is the right way round for a warn-level
 * signal whose value depends on being believed.
 */
/**
 * Correction connectives that BIND two terms into "wrong word, right word". Kept small on purpose;
 * every widening below has cost a false negative.
 */
const CONNECTIVE = '(?:instead of|rather than|as opposed to|not:?|never|i\\.e\\.|e\\.g\\.|meaning|aka)';
const RENAME_VERB = '(?:renam(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|chang(?:e|ed|es|ing)|call(?:ed|s)?|spell(?:ed|ing)?|prefer(?:red|s)?|writ(?:e|ten))';
const METALINGUISTIC = '(?:the term|the word|the noun|the spelling|spell(?:ed|ing)?|says?|said|written|reads?)';

/**
 * PURE: spans in `blob` where `variant` is BOUND to `canonical` by the grammar of correcting a word.
 * Returns [start, end) index pairs.
 *
 * Binding, not proximity. Every pattern here requires the two terms to be joined by an explicit
 * connective within a tight gap — not merely to co-occur near a marker word somewhere in a window.
 */
function mentionSpans(src, variant, canonical) {
  const V = escapeRe(variant);
  const C = escapeRe(canonical);
  const B = '(?![A-Za-z0-9-])';
  const A = '(?:^|[^A-Za-z0-9-])';
  const patterns = [
    // "audit instead of assessment" / "assessment not audit" — either order, tight gap.
    `${A}${V}${B}[^.]{0,4}?\\s*${CONNECTIVE}\\s+(?:the\\s+)?${C}${B}`,
    `${A}${C}${B}[^.]{0,4}?\\s*${CONNECTIVE}\\s+(?:the\\s+)?${V}${B}`,
    // "audit -> assessment", "assessment → audit"
    `${A}${V}${B}\\s*(?:→|->)\\s*${C}${B}`,
    `${A}${C}${B}\\s*(?:→|->)\\s*${V}${B}`,
    // "rename the audit field to assessment" — verb, variant, binder, canonical, all one clause.
    `${RENAME_VERB}\\b[^.]{0,30}?${A}${V}${B}[^.]{0,25}?\\b(?:to|with|as|into|over)\\b[^.]{0,25}?${C}${B}`,
    // "the term audit", 'says "audit"'
    `${METALINGUISTIC}\\s+["'\`]?${V}${B}`,
    // a quoted variant — you quote a word to talk about it
    `["'\`]${V}["'\`]`,
    // "audit, assessment" — comma apposition, only when immediately adjacent
    `${A}${V},\\s*${C}${B}`,
    `${A}${C},\\s*${V}${B}`,
  ];
  const spans = [];
  for (const p of patterns) {
    const re = new RegExp(p, 'gi');
    let m;
    while ((m = re.exec(src))) {
      spans.push([m.index, m.index + m[0].length]);
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return spans;
}

/**
 * PURE: is EVERY occurrence of `variant` a mention of the word rather than a use of it?
 *
 * REWRITTEN after FRW-BL-118's blind review. The first design asked two loose questions — is the
 * canonical term in the same clause, and is any marker word in that clause — and the reviewer broke
 * it four ways on ordinary prose, all reproduced before this rewrite:
 *
 *   FALSE NEGATIVE  "The compliance assessment must never be skipped, and separately the audit runs
 *                    nightly..." — one run-on sentence, so an unrelated "never"+"assessment" pair
 *                    excused a genuine "audit" 50 characters later.
 *   FALSE NEGATIVE  "We call the audit process every night, per the assessment schedule." — "call"
 *                    was a marker word, so ordinary prose suppressed itself.
 *   FALSE NEGATIVE  "The canonical audit workflow feeds the assessment pipeline." — same, via
 *                    "canonical".
 *   FALSE POSITIVE  "Note re: the audit i.e. assessment naming..." — the clause was split on the
 *                    first ".", which is inside "i.e.", cutting the canonical term out of view.
 *
 * Two root causes, and the marker list was only the visible one. Splitting clauses on "." is wrong
 * because abbreviations contain periods; and a marker ANYWHERE in a window says nothing about THIS
 * occurrence. Both are fixed by asking a different question: is this occurrence BOUND to the
 * canonical term by correction grammar? An occurrence inside "audit instead of assessment" is a
 * mention. An occurrence 50 characters from an unrelated "never" is not.
 *
 * Same shape as before and as `isNegatedOccurrence`: all-or-nothing over occurrences, so one bare
 * use anywhere makes the whole source a finding. Residual error stays false-NEGATIVE — an exotic
 * correction phrasing this list does not know is treated as drift, which is the safe direction for
 * a warn-level check whose value depends on being believed.
 */
export function isMetaReference(blob, variant, canonical) {
  const src = String(blob ?? '');
  const canon = String(canonical ?? '');
  if (!canon) return false;
  const spans = mentionSpans(src, variant, canon);
  const re = new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(variant)}(?![A-Za-z0-9-])`, 'gi');
  let m;
  let sawAny = false;
  while ((m = re.exec(src))) {
    sawAny = true;
    const hit = m.index + m[1].length;
    const bound = spans.some(([s, e]) => hit >= s && hit < e);
    if (!bound) return false; // a bare use — real drift
  }
  return sawAny;
}

/** Pure: find forbidden variants USED in a named source (mentions of the word are not uses). */
export function detectDrift(glossary, sources) {
  const findings = [];
  for (const { name, text } of Array.isArray(sources) ? sources : []) {
    const src = String(text ?? '');
    for (const term of Array.isArray(glossary) ? glossary : []) {
      for (const variant of term.variants) {
        if (wordRe(variant).test(src) && !isMetaReference(src, variant, term.canonical)) {
          findings.push({
            severity: 'warn',
            source: name,
            detail: `uses "${variant}" where the glossary defines "${term.canonical}"`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Pure: a card that contradicts an ACTIVE constraints.md rule — reported CRITICAL.
 *
 * Only NON-suppressed steering rules count. A `[SUPPRESSED]` rule was deliberately switched off, and
 * enforcing a rule the operator turned off would make the whole report untrustworthy.
 */
export function extractActiveRules(constraintsSrc) {
  const out = [];
  const lines = String(constraintsSrc ?? '').split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,4}\s+steering rules\b/i.test(line)) { inSection = true; continue; }
    if (inSection && /^#{1,4}\s+/.test(line)) break;
    if (!inSection) continue;
    if (/\[SUPPRESSED\]/i.test(line)) continue;
    const m = /^\s*[-*]\s*(?:\[([A-Z][A-Z0-9-]*-\d{3})\]|\*\*(SR-\d+):\*\*)\s*(.+)$/.exec(line);
    if (m) out.push({ card: m[1] || m[2], text: m[3].replace(/\s*\(score:.*$/, '').trim() });
  }
  return out;
}

/** Minimum words in a phrase before a verbatim match is specific enough to justify a CRITICAL. */
export const MIN_CONFLICT_WORDS = 4;

/**
 * Pure: the phrase prefixes worth testing, longest first.
 *
 * Requiring the WHOLE forbidden phrase verbatim is too brittle to be useful: a rule saying "never
 * store long-lived service principals IN THE SCANNER" would miss a card proposing to store them
 * "FOR CONVENIENCE", which is the same violation. The distinctive part is the head of the phrase.
 *
 * So it tries the full phrase, then successively shorter prefixes, stopping at MIN_CONFLICT_WORDS —
 * below which a match stops being evidence of anything. Longest-first means the reported phrase is
 * the most specific one that actually matched, so the finding can be audited rather than trusted.
 */
export function conflictPhrases(forbidden) {
  const words = String(forbidden ?? '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let n = words.length; n >= MIN_CONFLICT_WORDS; n--) {
    const phrase = words.slice(0, n).join(' ');
    if (phrase.length >= 20) out.push(phrase);
  }
  return out;
}

/**
 * Words that flip a mention from PROPOSING a thing to REFUSING it.
 *
 * A card saying "we audit the code to ensure we do not store credentials in logs" contains the
 * forbidden phrase verbatim while promising the opposite. Without this, the most compliance-minded
 * card in the backlog is the one most likely to be flagged CRITICAL.
 */
const NEGATION_RE = /\b(?:not|never|avoid|avoids|avoiding|prevent|prevents|preventing|prohibit|prohibits|forbid|forbids|forbidden|refuse|refuses|without|no longer|stop|stops|ensure|ensures|ensuring|verify|verifies|guard|guards|reject|rejects|must not|cannot|can't|don't|doesn't|won't)\b/i;

/** Pure: is this occurrence negated by something in the words just before it? */
export function isNegatedOccurrence(blob, phrase) {
  const src = String(blob ?? '');
  const re = new RegExp(`(^|[^A-Za-z0-9-])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'gi');
  let m;
  let sawAny = false;
  while ((m = re.exec(src))) {
    sawAny = true;
    // Look back a short window — far enough to catch "ensure we do not X", short enough that an
    // unrelated negation two sentences earlier does not excuse a real violation.
    const start = Math.max(0, m.index - 60);
    const before = src.slice(start, m.index);
    const window = before.slice(before.lastIndexOf('.') + 1);
    if (!NEGATION_RE.test(window)) return false; // an un-negated occurrence is a real proposal
  }
  return sawAny; // every occurrence was negated
}

/**
 * Pure: a card that proposes what an ACTIVE steering rule forbids — reported CRITICAL.
 *
 * Conservative on purpose, and made more so after a blind review reproduced a FALSE CRITICAL: a
 * card describing compliant work ("audit the code to ensure we do not store customer PII in log
 * files") matched the forbidden phrase verbatim and was reported as proposing the violation. That
 * is the worst possible direction for a gate-blocking severity — the most careful card in the
 * backlog is the one most likely to quote the rule it is honouring. A CRITICAL that cries wolf gets
 * the whole report ignored.
 *
 * So: verbatim multi-word phrase rather than fuzzy similarity, skip already-done work (the conflict
 * is about what is still to come), never enforce a `[SUPPRESSED]` rule, and skip an occurrence that
 * is negated in the clause it sits in. A card must have at least one UN-negated use to be flagged.
 *
 * The residual error direction is now false-NEGATIVE — a card that proposes a violation while
 * happening to use a negation word nearby is missed. That is the right way round: this reports at
 * CRITICAL, and a missed finding costs less than a gate nobody believes.
 */
export function detectConstraintConflicts(cards, rules) {
  const findings = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const m = /\b(?:never|do not|don't|must not)\s+(.{4,80}?)(?:[.,;]|$)/i.exec(rule.text || '');
    if (!m) continue;
    const phrases = conflictPhrases(m[1].trim());
    if (phrases.length === 0) continue;
    for (const card of Array.isArray(cards) ? cards : []) {
      if (!card || card.status === 'done' || card.status === 'skipped') continue;
      const blob = [card.title, card.description, card.technicalNotes].filter(Boolean).join('\n');
      const hit = phrases.find((p) => wordRe(p).test(blob) && !isNegatedOccurrence(blob, p));
      if (hit) {
        findings.push({
          severity: 'CRITICAL',
          source: card.id,
          detail: `card proposes "${hit}", which an active steering rule (${rule.card}) forbids: "${String(rule.text).slice(0, 90)}"`,
        });
      }
    }
  }
  return findings;
}

/** Pure: the whole analysis, over injected inputs. */
export function analyze({ blueprint = '', cards = [], sows = [], constraints = '' } = {}) {
  const requirements = extractRequirements(blueprint);
  const coverage = mapCoverage(requirements, cards);
  const glossary = extractGlossary(blueprint);
  // FRW-BL-117/118: the same helper the coverage mapper uses, unconditionally. The field sets
  // cannot diverge, and mention-vs-use is handled in detectDrift where it belongs rather than by
  // withholding fields from the scan.
  const cardSources = (Array.isArray(cards) ? cards : [])
    .map((c) => ({ name: `card ${c?.id}`, text: cardText(c) }));
  const drift = detectDrift(glossary, [...sows, ...cardSources]);
  const conflicts = detectConstraintConflicts(cards, extractActiveRules(constraints));
  const duplicates = requirements.filter((r) => r.duplicate).map((r) => ({
    severity: 'CRITICAL', source: 'blueprint',
    detail: `requirement ${r.id} is declared twice (lines ${r.firstSeenLine} and ${r.line}) — an id must identify exactly one requirement`,
  }));

  const findings = [
    ...duplicates,
    ...conflicts,
    ...coverage.uncovered.map((r) => ({
      severity: 'warn', source: 'blueprint',
      detail: `${r.id} (line ${r.line}) has no covering card: "${r.text.slice(0, 70)}"`,
    })),
    // Orphan citations are reported ONLY once the blueprint has adopted the scheme. On a blueprint
    // with zero requirement ids, every id-shaped token in every card is an "orphan" — a real run
    // against `clear` produced 24 near-identical warnings for a pre-existing, unrelated SC-0xx
    // numbering scheme of its own. That is first-run noise on every existing project, and noise is
    // how a check gets switched off. Same "nothing to check" philosophy already applied to coverage.
    ...(requirements.some((r) => !r.duplicate) ? coverage.orphanCitations.map((o) => ({
      severity: 'warn', source: o.cards.map((c) => c.id).join(','),
      detail: `cites ${o.id}, which the blueprint does not declare`,
    })) : []),
    ...drift,
  ];
  return {
    requirements, glossary, coverage, findings,
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
  };
}

export function formatReport(result) {
  const l = [];
  l.push(`[spec-coverage] ${result.requirements.filter((r) => !r.duplicate).length} requirement(s), `
    + `${result.coverage.covered.length} covered, ${result.coverage.uncovered.length} uncovered, `
    + `${result.glossary.length} glossary term(s)`);
  for (const f of result.findings) l.push(`[spec-coverage] ${String(f.severity).padEnd(8)} ${f.source}: ${f.detail}`);
  l.push(`[spec-coverage] ${result.findings.length} finding(s), ${result.critical} CRITICAL`);
  if (result.requirements.length === 0) {
    l.push('[spec-coverage] NOTE: no requirement ids found. This is "nothing to check", NOT "everything is covered" '
      + '— a blueprint without ids cannot be analysed. See the ID scheme in this script\'s header.');
  }
  return l.join('\n');
}

// --- I/O ---------------------------------------------------------------------

const arg = (argv, n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

async function main(argv) {
  const project = arg(argv, '--project');
  const api = process.env.VLDR_API_URL || 'http://localhost:3141';
  const home = process.env.VLDR_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.volundr');

  let blueprintPath = arg(argv, '--blueprint');
  let constraintsPath = arg(argv, '--constraints');
  let cards = [];

  if (project) {
    blueprintPath = blueprintPath || join(home, 'projects', project, 'blueprint.md');
    constraintsPath = constraintsPath || join(home, 'projects', project, 'constraints.md');
    try {
      const res = await fetch(`${api}/api/projects/${project}/cards`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cards = await res.json();
    } catch (e) {
      process.stdout.write(`[spec-coverage] UNKNOWN — could not read cards (${e.message}). `
        + 'This is NOT a clean report.\n');
      process.exitCode = 2;
      return;
    }
  }

  if (!blueprintPath || !existsSync(blueprintPath)) {
    process.stdout.write(`[spec-coverage] UNKNOWN — no blueprint at ${blueprintPath || '(unspecified)'}. `
      + 'A missing blueprint is not a clean blueprint.\n');
    process.exitCode = 2;
    return;
  }

  const result = analyze({
    blueprint: readFileSync(blueprintPath, 'utf8'),
    cards,
    constraints: constraintsPath && existsSync(constraintsPath) ? readFileSync(constraintsPath, 'utf8') : '',
  });

  process.stdout.write(argv.includes('--json')
    ? JSON.stringify(result, null, 2) + '\n'
    : formatReport(result) + '\n');
  process.exitCode = result.critical > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
