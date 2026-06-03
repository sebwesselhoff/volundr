# Judge Calibration Corpus (FRW-BL-047)

Nothing watches the watcher. Volundr's blind-review judge
(`framework/packs/quality/prompts/card-reviewer.md`) scores every completed card, but if that
judge silently **drifts** — grade inflation, ISC false-positives, band creep — bad cards merge and
good ones get rejected and we'd never notice. This corpus calibrates the judge against
**known-correct outcomes** and a deterministic harness reports precision / drift, harsh-critic
style (no embeddings, no fuzzy matching — a calibration check that is itself fuzzy proves nothing).

## What's here

```
fixtures/*.json        — cards + diffs with KNOWN-CORRECT outcomes (the ground truth)
judge-outputs/*.json   — one recorded card-reviewer verdict per fixture ("the judge ran")
baseline.json          — accepted metrics snapshot; --check gates against it
../../../scripts/judge-calibration.mjs        — the harness (pure Node, no deps)
../../../scripts/judge-calibration.test.mjs   — deterministic self-test
```

Fixtures span all five score bands — **reject, weak, baseline, strong, reference** — and include
both ISC-pass and ISC-fail cases plus borderline scores near band boundaries. The recorded
judge-outputs mostly **agree** with the fixtures' `expected` block (a well-calibrated judge);
**1–2 deliberately disagree** (`fx-06`, `fx-09`) so precision lands below 100% and is a meaningful,
non-trivial number.

## Score bands (from the reviewer rubric)

| band | weightedScore | meaning |
|------|---------------|---------|
| reject | ≤ 3.49 | broken / missing major requirements |
| weak | ≤ 5.49 | partial, significant gaps |
| baseline | ≤ 7.49 | meets spec — the bar for "done" |
| strong | ≤ 8.49 | clean, handles edges, tight conventions |
| reference | else | you'd show this to a new hire |

`weightedScore = (completeness*3 + codeQuality*3 + formatCompliance*2 + correctness*2) / 10`.

## Fixture shape

```jsonc
{
  "id": "...", "label": "<band>",
  "card": { "title", "description", "technicalNotes", "isc": ["criterion text", ...] },
  "diff": "<unified diff or representative changed-file contents>",
  "expected": {
    "iscVerdicts": [ { "criterion": "...", "passed": true|false } ],  // ground-truth per ISC
    "scoreBand": "reject|weak|baseline|strong|reference",
    "weightedScoreRange": [min, max]                                  // inclusive
  }
}
```

A judge-output mirrors the card-reviewer JSON contract: `{ cardId, isc[], completeness,
codeQuality, formatCompliance, correctness, weightedScore, confidence, summary, issues }`. The
`cardId` (or `id`) must equal the fixture `id` so the harness pairs them order-independently.

## Metrics

- **ISC precision** = TP / (TP+FP) — of the ISC the judge *passed*, how many should pass. The
  anti-grade-inflation metric: a false-positive is the judge passing a criterion the code fails.
- **ISC recall** = TP / (TP+FN) — of the ISC that should pass, how many the judge passed.
  Guards against over-rejection.
- **ISC accuracy** = exact-match criteria / total criteria across the corpus.
- **band accuracy** = fixtures whose `bandForScore(weightedScore)` equals the expected band.
- **score-range hit rate** = fixtures whose weightedScore landed inside the expected range.
- **weighted-consistency** = fixtures whose stated weightedScore equals its own recomputed
  formula (±0.05) — does the judge do its own arithmetic correctly?

Matching is **exact**: ISC by (whitespace-normalized) criterion text, band by boundary, score by
numeric range. No embeddings, no fuzzy similarity.

## Running it

```bash
node scripts/judge-calibration.mjs                  # print the metrics report
node scripts/judge-calibration.mjs --check          # CI gate: exit 1 if drift breaches baseline
node scripts/judge-calibration.mjs --write-baseline # regenerate baseline.json from this run
node scripts/judge-calibration.test.mjs             # deterministic self-test
# --dir <path> points the harness at an alternate corpus copy
```

## How `--check` gates drift in CI

`--check` recomputes metrics on the committed corpus, compares each to `baseline.json`, and
**exits 1 if any metric drops more than the threshold** (default `0.05`; improvements never fail).
Wire it into the docs/CI guard alongside `garden-lint`. When the judge legitimately improves (or
you intentionally re-calibrate), regenerate the baseline with `--write-baseline` and commit it.

## Regenerating judge-outputs (when the prompt changes)

The committed judge-outputs are a *recording* so the harness runs with no live LLM. When
`card-reviewer.md` changes, re-run the judge on each fixture to refresh them:

1. For each `fixtures/<id>.json`, fill the card-reviewer template slots from the fixture:
   `{CARD_ID}=id`, `{CARD_TITLE}/{CARD_DESCRIPTION}/{CARD_TECHNICAL_NOTES}` from `card`,
   `{ISC_CRITERIA}` from `card.isc`, `{FILE_CONTENTS}`/`{GIT_DIFF_STAT}` from `diff`.
2. Run the prompt (manually or scripted) and save the JSON verdict to
   `judge-outputs/<id>.json`, setting `cardId` to the fixture `id`.
3. `node scripts/judge-calibration.mjs` to inspect, then `--write-baseline` to accept the new
   numbers, and commit both the refreshed outputs and the baseline.

Keep most outputs honest; keep a couple deliberately-miscalibrated so precision stays a live,
testable signal rather than a constant 100%.
