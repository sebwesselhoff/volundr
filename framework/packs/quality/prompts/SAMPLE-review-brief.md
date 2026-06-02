# Sample: Truncation-Resistant Reviewer Brief (FRW-BL-023)

A reference brief that produces a **complete JSON verdict in a single response** under
representative review load. Use this shape whenever you spawn a blind card reviewer.

The governing principle: state the JSON requirement FIRST (mental priming), make the JSON
the only mandatory deliverable, cap exploration, and instruct the agent to emit the JSON
before any prose if it must choose. See `card-reviewer.md` § OUTPUT CONTRACT and
`system-instructions.md` § Truncation Recovery.

## The brief skeleton

```
You are a blind code reviewer for ONE card. You did NOT write it. Be skeptical.

## REQUIRED OUTPUT — emit this JSON block FIRST, before any prose. If forced, emit ONLY the JSON.
{
  "completeness": <1-10>, "codeQuality": <1-10>,
  "formatCompliance": <1-10>, "correctness": <1-10>,
  "iscVerdicts": [{"criterion": "...", "passed": <bool>, "evidence": "<short>"}],
  "summary": "<=120 words"
}

## CARD {ID} ({SIZE}): {TITLE}
{GOAL + ISC criteria, numbered}

## Evidence
{diff inline + "you may Read these files (≤6 reads): ..."}

Keep prose ≤120 words. No file-content dumps. Emit the JSON verdict.
```

## Empirical result (representative-load self-test)

| Date | Card | Model | Brief style | Outcome |
|------|------|-------|-------------|---------|
| 2026-06-02 | FRW-BL-025 (S, hook + 15-case test + doc) | Haiku | JSON-first (this skeleton) | **Complete JSON returned, 0 truncations.** 5 ISC verdicts + 4 scores + summary, all parseable. 4 file reads, ~56s. |

Contrast: the CLEAR overnight run (session-summary 38, 2026-05-18..19) saw ≥5 subagents
truncate mid-analysis under open-ended briefs (`ATL-001 reviewer` truncated *before* its JSON
score; `AUD-001 reviewer` mid-pillar-count). Same model class, no JSON-first contract → lost
deliverables and forced re-spawns. The contract is the difference.

## How to re-run the self-test

Spawn a Haiku reviewer with the skeleton above against any completed card's diff and confirm
the response contains a complete, JSON-parseable verdict object. A complete JSON block in a
single response = pass.
