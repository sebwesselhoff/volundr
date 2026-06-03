// Self-test for judge-calibration.mjs (FRW-BL-047). Run: node scripts/judge-calibration.test.mjs
// Deterministic, no deps. Covers band boundaries, weighted recompute, per-verdict scoring,
// corpus precision/recall math on a synthetic set with known answers, and drift detection.
import {
  bandForScore, recomputeWeighted, scoreVerdict, evaluateCorpus, detectDrift,
  metricsSnapshot, DEFAULT_DRIFT_THRESHOLD,
} from './judge-calibration.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('judge-calibration self-test\n');

// --- bandForScore boundaries (the contract: ≤3.49 ≤5.49 ≤7.49 ≤8.49 else) -----------------
console.log('bandForScore boundaries');
ok('1.0 → reject', bandForScore(1.0) === 'reject');
ok('3.49 → reject (upper edge)', bandForScore(3.49) === 'reject');
ok('3.50 → weak (just over)', bandForScore(3.50) === 'weak');
ok('5.49 → weak (upper edge)', bandForScore(5.49) === 'weak');
ok('5.50 → baseline (just over)', bandForScore(5.50) === 'baseline');
ok('7.49 → baseline (upper edge)', bandForScore(7.49) === 'baseline');
ok('7.50 → strong (just over)', bandForScore(7.50) === 'strong');
ok('8.49 → strong (upper edge)', bandForScore(8.49) === 'strong');
ok('8.50 → reference (just over)', bandForScore(8.50) === 'reference');
ok('10.0 → reference', bandForScore(10.0) === 'reference');
ok('non-finite → null', bandForScore('nope') === null && bandForScore(NaN) === null);

// --- recomputeWeighted -----------------------------------------------------------------------
console.log('\nrecomputeWeighted');
ok('all 9s → 9.0', approx(recomputeWeighted({ completeness: 9, codeQuality: 9, formatCompliance: 9, correctness: 9 }), 9.0));
ok('10/9/10/9 → 9.5', approx(recomputeWeighted({ completeness: 10, codeQuality: 9, formatCompliance: 10, correctness: 9 }), 9.5));
ok('7/7/8/8 → 7.4', approx(recomputeWeighted({ completeness: 7, codeQuality: 7, formatCompliance: 8, correctness: 8 }), 7.4));
ok('1/2/2/2 → 1.7', approx(recomputeWeighted({ completeness: 1, codeQuality: 2, formatCompliance: 2, correctness: 2 }), 1.7));
ok('missing dimension → null', recomputeWeighted({ completeness: 7, codeQuality: 7 }) === null);
ok('null verdict → null', recomputeWeighted(null) === null);

// --- scoreVerdict: exact match (well-calibrated verdict) -------------------------------------
console.log('\nscoreVerdict (exact match)');
const fixMatch = {
  id: 'm1',
  expected: {
    iscVerdicts: [
      { criterion: 'A passes', passed: true },
      { criterion: 'B fails', passed: false },
    ],
    scoreBand: 'baseline',
    weightedScoreRange: [6.0, 7.49],
  },
};
const verMatch = {
  cardId: 'm1',
  isc: [
    { criterion: 'A passes', passed: true },
    { criterion: 'B fails', passed: false },
  ],
  completeness: 7, codeQuality: 7, formatCompliance: 7, correctness: 7, weightedScore: 7,
};
const rm = scoreVerdict(fixMatch, verMatch);
ok('iscMatches=2/2', rm.iscMatches === 2 && rm.iscTotal === 2);
ok('iscTruePos=1 (A)', rm.iscTruePos === 1);
ok('no false pos/neg on exact match', rm.iscFalsePos === 0 && rm.iscFalseNeg === 0);
ok('bandMatch true (7→baseline)', rm.bandMatch === true);
ok('scoreInRange true', rm.scoreInRange === true);
ok('weightedConsistent true (7=recompute)', rm.weightedConsistent === true);

// whitespace-normalized criterion text still matches (NOT fuzzy — only whitespace)
const verWs = { ...verMatch, isc: [{ criterion: '  A   passes ', passed: true }, { criterion: 'B fails', passed: false }] };
ok('whitespace-normalized criterion matches', scoreVerdict(fixMatch, verWs).iscMatches === 2);

// --- scoreVerdict: mismatch cases ------------------------------------------------------------
console.log('\nscoreVerdict (mismatch)');
// Judge inflates: says B passes (truth: fail) → false positive; band/range still right
const verInflate = { ...verMatch, isc: [{ criterion: 'A passes', passed: true }, { criterion: 'B fails', passed: true }] };
const ri = scoreVerdict(fixMatch, verInflate);
ok('false positive counted (judge passed a should-fail ISC)', ri.iscFalsePos === 1);
ok('iscMatches drops to 1', ri.iscMatches === 1);

// Judge over-rejects: says A fails (truth: pass) → false negative
const verReject = { ...verMatch, isc: [{ criterion: 'A passes', passed: false }, { criterion: 'B fails', passed: false }] };
const rr = scoreVerdict(fixMatch, verReject);
ok('false negative counted (judge failed a should-pass ISC)', rr.iscFalseNeg === 1);

// Band miss + range miss: judge gives ws 9 (reference) where baseline expected
const verBandMiss = { cardId: 'm1', isc: verMatch.isc, completeness: 9, codeQuality: 9, formatCompliance: 9, correctness: 9, weightedScore: 9 };
const rb = scoreVerdict(fixMatch, verBandMiss);
ok('bandMatch false (9→reference≠baseline)', rb.bandMatch === false);
ok('scoreInRange false (9 outside [6,7.49])', rb.scoreInRange === false);

// Judge arithmetic inconsistency: states 8 but dims compute to 7
const verBadMath = { cardId: 'm1', isc: verMatch.isc, completeness: 7, codeQuality: 7, formatCompliance: 7, correctness: 7, weightedScore: 8 };
ok('weightedConsistent false when stated≠computed', scoreVerdict(fixMatch, verBadMath).weightedConsistent === false);

// Criterion the judge never assessed → treated as not-passed, and is NOT counted as a match
// (an omission is a disagreement, not silent agreement — harsh-critic semantics).
const verMissing = { cardId: 'm1', isc: [{ criterion: 'A passes', passed: true }], completeness: 7, codeQuality: 7, formatCompliance: 7, correctness: 7, weightedScore: 7 };
const rmiss = scoreVerdict(fixMatch, verMissing);
ok('un-assessed ISC is not a match (only A matches → 1/2)', rmiss.iscMatches === 1 && rmiss.iscTotal === 2);
ok('un-assessed should-fail ISC is no false-neg/false-pos', rmiss.iscFalseNeg === 0 && rmiss.iscFalsePos === 0);

// --- evaluateCorpus: synthetic set with hand-computed answers --------------------------------
console.log('\nevaluateCorpus (known answers)');
// Fixture X: 2 ISC both should pass (band reference). Fixture Y: 1 should pass, 1 should fail (band weak).
const fixtures = [
  { id: 'X', expected: { iscVerdicts: [{ criterion: 'x1', passed: true }, { criterion: 'x2', passed: true }], scoreBand: 'reference', weightedScoreRange: [8.6, 10] } },
  { id: 'Y', expected: { iscVerdicts: [{ criterion: 'y1', passed: true }, { criterion: 'y2', passed: false }], scoreBand: 'weak', weightedScoreRange: [4.0, 5.49] } },
];
const judgeOutputs = [
  // X: judge nails both passes, band reference, ws 9 (consistent), in range
  { cardId: 'X', isc: [{ criterion: 'x1', passed: true }, { criterion: 'x2', passed: true }], completeness: 9, codeQuality: 9, formatCompliance: 9, correctness: 9, weightedScore: 9 },
  // Y: judge INFLATES y2 (should fail → judge passes) = 1 FP; y1 correct pass = 1 TP; band weak, ws 4.7 consistent in range
  { cardId: 'Y', isc: [{ criterion: 'y1', passed: true }, { criterion: 'y2', passed: true }], completeness: 4, codeQuality: 5, formatCompliance: 5, correctness: 5, weightedScore: 4.7 },
];
const corpus = evaluateCorpus(fixtures, judgeOutputs);
// TP: x1,x2,y1 = 3. FP: y2 = 1. FN: 0.
ok('precision = 3/(3+1) = 0.75', approx(corpus.iscPrecision, 0.75));
ok('recall = 3/(3+0) = 1.0', approx(corpus.iscRecall, 1.0));
// iscAccuracy: X 2/2 match; Y y1 match, y2 mismatch → 3/4 = 0.75
ok('iscAccuracy = 3/4 = 0.75', approx(corpus.iscAccuracy, 0.75));
ok('bandAccuracy = 2/2 = 1.0', approx(corpus.bandAccuracy, 1.0));
ok('scoreRangeHitRate = 2/2 = 1.0', approx(corpus.scoreRangeHitRate, 1.0));
ok('weightedConsistencyRate = 2/2 = 1.0', approx(corpus.weightedConsistencyRate, 1.0));
ok('n = 2', corpus.n === 2);
ok('perFixture has 2 rows', corpus.perFixture.length === 2);

// accepts object-keyed judgeOutputs too (order-independent)
const corpusObj = evaluateCorpus(fixtures, { X: judgeOutputs[0], Y: judgeOutputs[1] });
ok('object-keyed judgeOutputs give same precision', approx(corpusObj.iscPrecision, 0.75));

// missing judge output for a fixture → no crash, ISC treated as fail
const corpusMissing = evaluateCorpus(fixtures, [judgeOutputs[0]]);
ok('missing verdict handled (FN on Y.y1)', corpusMissing.counts.fn === 1);

// --- detectDrift -----------------------------------------------------------------------------
console.log('\ndetectDrift');
const baseMetrics = { iscPrecision: 0.9, iscRecall: 0.9, iscAccuracy: 0.9, bandAccuracy: 0.9, scoreRangeHitRate: 0.9, weightedConsistencyRate: 1.0 };
// no drift: identical
const dSame = detectDrift(baseMetrics, baseMetrics);
ok('identical metrics → no drift', dSame.drifted === false && dSame.breaches.length === 0);
// small drop within threshold (0.04 < 0.05) → no breach
const dSmall = detectDrift({ ...baseMetrics, iscPrecision: 0.86 }, baseMetrics);
ok('drop of 0.04 (≤ default 0.05) → no breach', dSmall.drifted === false);
// drop beyond threshold → breach
const dBig = detectDrift({ ...baseMetrics, iscPrecision: 0.80 }, baseMetrics);
ok('drop of 0.10 (> 0.05) → breach', dBig.drifted === true && dBig.breaches[0].metric === 'iscPrecision');
ok('breach delta is negative', dBig.breaches[0].delta < 0);
// improvement never breaches
const dUp = detectDrift({ ...baseMetrics, iscPrecision: 1.0 }, baseMetrics);
ok('improvement → no breach', dUp.drifted === false && dUp.deltas.iscPrecision > 0);
// custom per-metric threshold
const dCustom = detectDrift({ ...baseMetrics, bandAccuracy: 0.88 }, baseMetrics, { bandAccuracy: 0.01 });
ok('tighter per-metric threshold catches a 0.02 drop', dCustom.drifted === true && dCustom.breaches[0].metric === 'bandAccuracy');
// exactly at threshold boundary → NOT a breach (strictly greater than)
const dEdge = detectDrift({ ...baseMetrics, iscRecall: 0.85 }, baseMetrics, DEFAULT_DRIFT_THRESHOLD);
ok('drop of exactly 0.05 → no breach (strict >)', dEdge.drifted === false);

// --- metricsSnapshot -------------------------------------------------------------------------
console.log('\nmetricsSnapshot');
const snap = metricsSnapshot(corpus);
ok('snapshot keeps n + 6 metrics, drops perFixture', snap.n === 2 && snap.perFixture === undefined && 'iscPrecision' in snap && 'weightedConsistencyRate' in snap);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
