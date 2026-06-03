#!/usr/bin/env node
/**
 * judge-calibration.mjs — calibrate the blind-review judge against a fixture corpus (FRW-BL-047)
 *
 * The judge being calibrated is framework/packs/quality/prompts/card-reviewer.md — the blind
 * reviewer that scores every completed card. Nothing watches the watcher: if that judge silently
 * DRIFTS (grade inflation, ISC false-positives, band creep), bad cards merge and good ones get
 * rejected, and we'd never notice. This harness fixes that, harsh-critic style:
 *
 *   1. A FIXTURE CORPUS (framework/quality/calibration/fixtures/*.json) of cards+diffs with
 *      KNOWN-CORRECT outcomes (band + per-ISC truth + weighted-score range).
 *   2. RECORDED JUDGE OUTPUTS (framework/quality/calibration/judge-outputs/*.json) — one verdict
 *      per fixture in the card-reviewer JSON shape, so the harness runs deterministically NOW,
 *      with no live LLM. Regenerate them by running the card-reviewer prompt on each fixture
 *      (see calibration/README.md).
 *   3. DETERMINISTIC SCORING — exact comparison by criterion text + band + numeric range.
 *      NO embeddings, NO fuzzy matching (the harsh-critic rationale: a calibration check that is
 *      itself fuzzy can't prove anything). Reports precision / recall / accuracy / drift.
 *   4. A DRIFT GATE — `--check` compares the current run to a committed baseline.json and exits 1
 *      if any metric regresses beyond threshold, so CI catches judge drift over time.
 *
 * Pure Node, NO external deps (the worktree has no node_modules).
 *
 * USAGE:
 *   node scripts/judge-calibration.mjs                 # print metrics report
 *   node scripts/judge-calibration.mjs --check         # gate: exit 1 if drift breaches baseline
 *   node scripts/judge-calibration.mjs --write-baseline # regenerate baseline.json from this run
 *   (optional: --dir <calibration dir> to point at an alternate corpus)
 * EXIT: 0 normally; 1 on --check drift breach (or load error).
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// --- band model -------------------------------------------------------------

/** Ordered bands, low → high. Index doubles as ordinal severity. */
export const BANDS = ['reject', 'weak', 'baseline', 'strong', 'reference'];

/**
 * Map a weighted score (1–10) to its calibration band. Clean, tested boundaries:
 *   ≤ 3.49 → reject, ≤ 5.49 → weak, ≤ 7.49 → baseline, ≤ 8.49 → strong, else reference.
 * Mirrors the card-reviewer rubric (1-3 reject, 4-5 weak, 6-7 baseline, 8 strong, 9-10 reference).
 */
export function bandForScore(weightedScore) {
  const s = Number(weightedScore);
  if (!Number.isFinite(s)) return null;
  if (s <= 3.49) return 'reject';
  if (s <= 5.49) return 'weak';
  if (s <= 7.49) return 'baseline';
  if (s <= 8.49) return 'strong';
  return 'reference';
}

/**
 * Recompute the weighted score from a verdict's four dimensions, per the card-reviewer contract:
 *   (completeness*3 + codeQuality*3 + formatCompliance*2 + correctness*2) / 10.
 * Used to validate the judge's self-consistency (did it do its own arithmetic right?).
 */
export function recomputeWeighted(v) {
  if (!v || typeof v !== 'object') return null;
  const c = Number(v.completeness);
  const q = Number(v.codeQuality);
  const f = Number(v.formatCompliance);
  const k = Number(v.correctness);
  if (![c, q, f, k].every(Number.isFinite)) return null;
  return (c * 3 + q * 3 + f * 2 + k * 2) / 10;
}

// --- per-fixture scoring (deterministic, exact) -----------------------------

/** Normalize ISC criterion text for exact-key comparison: trim + collapse internal whitespace.
 *  This is NOT fuzzy matching — it only neutralizes incidental whitespace so JSON authored by
 *  hand vs. emitted by a model lines up. Wording differences are still a miss. */
function normCriterion(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Score a single judge verdict against a fixture's known-correct expectation. DETERMINISTIC:
 *   - ISC truth: matched by exact (whitespace-normalized) criterion text. The "positive" class is
 *     passed===true. truePos = expected-pass AND judge-pass; falsePos = judge-pass but
 *     expected-fail (inflation); falseNeg = expected-pass but judge-fail (over-rejection).
 *   - bandMatch: bandForScore(judge.weightedScore) === expected.scoreBand.
 *   - scoreInRange: judge.weightedScore within expected.weightedScoreRange [min,max] inclusive.
 *   - weightedConsistent: judge's stated weightedScore matches recomputeWeighted(judge) (±0.05),
 *     i.e. the judge's own arithmetic is internally consistent.
 * Returns counts/flags only — no aggregation, no fuzzy logic, no embeddings.
 */
export function scoreVerdict(fixture, judgeVerdict) {
  const exp = (fixture && fixture.expected) || {};
  const expIsc = Array.isArray(exp.iscVerdicts) ? exp.iscVerdicts : [];
  const judgeIsc = Array.isArray(judgeVerdict && judgeVerdict.isc) ? judgeVerdict.isc : [];

  // Build a lookup of judge verdicts by normalized criterion text.
  const judgeByCrit = new Map();
  for (const j of judgeIsc) judgeByCrit.set(normCriterion(j.criterion), j.passed === true);

  let iscTruePos = 0, iscFalsePos = 0, iscFalseNeg = 0, iscMatches = 0;
  const iscTotal = expIsc.length;
  for (const e of expIsc) {
    const key = normCriterion(e.criterion);
    const expectedPass = e.passed === true;
    const judgePass = judgeByCrit.get(key); // boolean, or undefined if judge never assessed it
    const judgedPass = judgePass === true;   // undefined → treated as fail (not assessed)

    if (judgePass === expectedPass) iscMatches++;
    if (expectedPass && judgedPass) iscTruePos++;
    else if (!expectedPass && judgedPass) iscFalsePos++; // judge said pass, truth says fail
    else if (expectedPass && !judgedPass) iscFalseNeg++; // judge said fail, truth says pass
  }

  const ws = Number(judgeVerdict && judgeVerdict.weightedScore);
  const judgeBand = bandForScore(ws);
  const bandMatch = judgeBand != null && judgeBand === exp.scoreBand;

  const range = Array.isArray(exp.weightedScoreRange) ? exp.weightedScoreRange : null;
  const scoreInRange = !!(range && Number.isFinite(ws) && ws >= range[0] && ws <= range[1]);

  const recomputed = recomputeWeighted(judgeVerdict);
  const weightedConsistent = recomputed != null && Number.isFinite(ws)
    && Math.abs(round4(recomputed) - ws) <= 0.05;

  return {
    id: fixture && fixture.id,
    iscTruePos, iscFalsePos, iscFalseNeg, iscMatches, iscTotal,
    judgeBand, expectedBand: exp.scoreBand, bandMatch,
    weightedScore: Number.isFinite(ws) ? ws : null, scoreInRange,
    recomputedWeighted: recomputed, weightedConsistent,
  };
}

// --- corpus aggregation -----------------------------------------------------

const safeRatio = (num, den) => (den > 0 ? round4(num / den) : 1);

/**
 * Aggregate scoreVerdict() over the whole corpus into calibration metrics.
 * judgeOutputs may be an array of verdicts or a Map/object keyed by fixture id; we index by
 * cardId / id so order doesn't matter.
 *   - iscPrecision = TP / (TP + FP)  → of ISC the judge PASSED, how many should pass (anti-inflation)
 *   - iscRecall    = TP / (TP + FN)  → of ISC that should pass, how many the judge passed
 *   - iscAccuracy  = matches / total ISC across the corpus
 *   - bandAccuracy = fixtures whose judge band == expected band
 *   - scoreRangeHitRate = fixtures whose weightedScore landed in the expected range
 *   - weightedConsistencyRate = fixtures whose judge arithmetic is internally consistent
 */
export function evaluateCorpus(fixtures, judgeOutputs) {
  const byId = new Map();
  const list = Array.isArray(judgeOutputs)
    ? judgeOutputs
    : Object.values(judgeOutputs || {});
  for (const v of list) {
    const key = v && (v.cardId != null ? v.cardId : v.id);
    if (key != null) byId.set(String(key), v);
  }

  let tp = 0, fp = 0, fn = 0, iscMatch = 0, iscTotal = 0;
  let bandHits = 0, rangeHits = 0, consistentHits = 0;
  const perFixture = [];

  for (const fx of fixtures) {
    const verdict = byId.get(String(fx.id)) || { isc: [], weightedScore: NaN };
    const r = scoreVerdict(fx, verdict);
    tp += r.iscTruePos; fp += r.iscFalsePos; fn += r.iscFalseNeg;
    iscMatch += r.iscMatches; iscTotal += r.iscTotal;
    if (r.bandMatch) bandHits++;
    if (r.scoreInRange) rangeHits++;
    if (r.weightedConsistent) consistentHits++;
    perFixture.push(r);
  }

  const n = fixtures.length;
  return {
    n,
    iscPrecision: safeRatio(tp, tp + fp),
    iscRecall: safeRatio(tp, tp + fn),
    iscAccuracy: safeRatio(iscMatch, iscTotal),
    bandAccuracy: safeRatio(bandHits, n),
    scoreRangeHitRate: safeRatio(rangeHits, n),
    weightedConsistencyRate: safeRatio(consistentHits, n),
    counts: { tp, fp, fn, iscMatch, iscTotal, bandHits, rangeHits, consistentHits },
    perFixture,
  };
}

// --- drift detection --------------------------------------------------------

/** The calibration metrics we gate on (all "higher is better"). */
export const DRIFT_METRICS = [
  'iscPrecision', 'iscRecall', 'iscAccuracy',
  'bandAccuracy', 'scoreRangeHitRate', 'weightedConsistencyRate',
];

export const DEFAULT_DRIFT_THRESHOLD = 0.05;

/**
 * Compare a current metrics object to a baseline. A metric "drifts" (breach) when it DROPS by more
 * than the threshold (regression). Improvements never breach. thresholds may be a single number
 * (applied to all metrics) or a per-metric object; metrics absent from `thresholds` use default.
 * Returns { drifted, deltas:{metric: current-baseline}, breaches:[{metric, baseline, current, delta, threshold}] }.
 */
export function detectDrift(current, baseline, thresholds = DEFAULT_DRIFT_THRESHOLD) {
  const thresholdFor = (m) => {
    if (typeof thresholds === 'number') return thresholds;
    if (thresholds && Number.isFinite(thresholds[m])) return thresholds[m];
    return DEFAULT_DRIFT_THRESHOLD;
  };
  const deltas = {};
  const breaches = [];
  for (const m of DRIFT_METRICS) {
    const cur = Number(current && current[m]);
    const base = Number(baseline && baseline[m]);
    if (!Number.isFinite(cur) || !Number.isFinite(base)) continue;
    const delta = round4(cur - base);
    deltas[m] = delta;
    const th = thresholdFor(m);
    if (delta < -th) breaches.push({ metric: m, baseline: base, current: cur, delta, threshold: th });
  }
  return { drifted: breaches.length > 0, deltas, breaches };
}

// --- IO + CLI ---------------------------------------------------------------

function loadJsonDir(dir) {
  const out = [];
  let names;
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { return out; }
  for (const name of names.sort()) {
    try { out.push(JSON.parse(readFileSync(join(dir, name), 'utf8'))); }
    catch (err) { throw new Error(`invalid JSON in ${join(dir, name)}: ${err.message}`); }
  }
  return out;
}

/** Load fixtures + judge-outputs from a calibration dir. Pure-ish (just fs). */
export function loadCorpus(calibrationDir) {
  const fixtures = loadJsonDir(join(calibrationDir, 'fixtures'));
  const judgeOutputs = loadJsonDir(join(calibrationDir, 'judge-outputs'));
  return { fixtures, judgeOutputs };
}

/** The metrics subset we snapshot into baseline.json (drop perFixture detail + counts). */
export function metricsSnapshot(metrics) {
  const snap = { n: metrics.n };
  for (const m of DRIFT_METRICS) snap[m] = metrics[m];
  return snap;
}

function formatReport(metrics) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const lines = [];
  lines.push(`[judge-calibration] corpus: ${metrics.n} fixture(s)`);
  lines.push(`  ISC precision           ${pct(metrics.iscPrecision)}   (TP=${metrics.counts.tp} FP=${metrics.counts.fp})  — guards against grade inflation`);
  lines.push(`  ISC recall              ${pct(metrics.iscRecall)}   (TP=${metrics.counts.tp} FN=${metrics.counts.fn})  — guards against over-rejection`);
  lines.push(`  ISC accuracy            ${pct(metrics.iscAccuracy)}   (${metrics.counts.iscMatch}/${metrics.counts.iscTotal} criteria)`);
  lines.push(`  band accuracy           ${pct(metrics.bandAccuracy)}   (${metrics.counts.bandHits}/${metrics.n} fixtures)`);
  lines.push(`  score-range hit rate    ${pct(metrics.scoreRangeHitRate)}   (${metrics.counts.rangeHits}/${metrics.n} fixtures)`);
  lines.push(`  weighted-consistency    ${pct(metrics.weightedConsistencyRate)}   (${metrics.counts.consistentHits}/${metrics.n} judge arithmetic checks)`);
  lines.push('  per-fixture:');
  for (const r of metrics.perFixture) {
    const flags = [
      r.bandMatch ? 'band✓' : `band✗(${r.judgeBand}≠${r.expectedBand})`,
      r.scoreInRange ? 'range✓' : 'range✗',
      r.weightedConsistent ? 'calc✓' : 'calc✗',
    ];
    const isc = `isc ${r.iscMatches}/${r.iscTotal}` + (r.iscFalsePos ? ` FP=${r.iscFalsePos}` : '') + (r.iscFalseNeg ? ` FN=${r.iscFalseNeg}` : '');
    lines.push(`    • ${String(r.id).padEnd(22)} ws=${r.weightedScore}  ${isc}  ${flags.join(' ')}`);
  }
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf('--dir');
  const calibrationDir = dirIdx >= 0
    ? argv[dirIdx + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..', 'framework', 'quality', 'calibration');
  const baselinePath = join(calibrationDir, 'baseline.json');

  let corpus;
  try { corpus = loadCorpus(calibrationDir); }
  catch (err) { process.stderr.write(`[judge-calibration] load error: ${err.message}\n`); process.exit(1); }

  if (corpus.fixtures.length === 0) {
    process.stderr.write(`[judge-calibration] no fixtures found in ${calibrationDir}/fixtures\n`);
    process.exit(1);
  }

  const metrics = evaluateCorpus(corpus.fixtures, corpus.judgeOutputs);
  const snapshot = metricsSnapshot(metrics);

  if (argv.includes('--write-baseline')) {
    const payload = { generatedAt: new Date().toISOString(), thresholds: DEFAULT_DRIFT_THRESHOLD, metrics: snapshot };
    writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
    process.stdout.write(formatReport(metrics) + '\n');
    process.stdout.write(`[judge-calibration] baseline written → ${baselinePath}\n`);
    process.exit(0);
  }

  process.stdout.write(formatReport(metrics) + '\n');

  if (argv.includes('--check')) {
    if (!existsSync(baselinePath)) {
      process.stderr.write(`[judge-calibration] --check: no baseline at ${baselinePath} (run --write-baseline first)\n`);
      process.exit(1);
    }
    const baselineDoc = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const baseMetrics = baselineDoc.metrics || baselineDoc;
    const thresholds = baselineDoc.thresholds != null ? baselineDoc.thresholds : DEFAULT_DRIFT_THRESHOLD;
    const drift = detectDrift(snapshot, baseMetrics, thresholds);
    if (drift.drifted) {
      process.stdout.write('[judge-calibration] DRIFT DETECTED — judge calibration regressed beyond threshold:\n');
      for (const b of drift.breaches) {
        process.stdout.write(`  ✗ ${b.metric}: ${b.baseline} → ${b.current} (Δ${b.delta}, allowed -${b.threshold})\n`);
      }
      process.exit(1);
    }
    process.stdout.write(`[judge-calibration] --check OK — no metric regressed > threshold vs baseline (${baselineDoc.generatedAt || 'unknown'}).\n`);
    process.exit(0);
  }

  process.exit(0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
