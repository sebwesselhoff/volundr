# Branch Protection & Push Discipline (FRW-BL-091)

Every push to `origin/main` across at least four sessions has been made with an admin bypass, and
each time it was noted in the journal and then forgotten. This document ends the re-noticing: it
records what is actually configured, why the bypass kept happening, and what the standing posture
is.

## What is actually configured

Protection on `main` is a **repository ruleset**, not classic branch protection — `GET
/repos/:owner/:repo/branches/main/protection` returns `404 Branch not protected`, which is why the
setup looked absent when checked the obvious way.

Ruleset **"Protect main"** (`id 14345267`, `enforcement: active`) applies four rules to `main`:

| Rule | Parameters |
|---|---|
| `deletion` | branch cannot be deleted |
| `non_fast_forward` | no force-push |
| `pull_request` | 1 approving review, dismiss stale reviews on push, **require code-owner review**, require review-thread resolution |
| `required_status_checks` | `Typecheck & lint`, `Build dashboard`, `Docs & spelling` |

## Why the bypass kept happening

The `pull_request` rule requires an approving review **from someone other than the author** on a
repository with a single maintainer, where an autonomous agent commits directly to `main`. That is
structurally unsatisfiable in the current workflow: there is no second reviewer, so every push
either bypasses the ruleset or does not happen. The bypass was not carelessness — it was the only
way forward, repeated without ever being written down as a decision.

## The finding that matters more than the bypass

Measured on CI run `31481686485` (commit `e47827a`, all jobs green):

| Job | Duration | Required? |
|---|---|---|
| Build dashboard | 86s | **yes** |
| Typecheck & lint | 73s | **yes** |
| Docs & spelling | 55s | **yes** |
| Framework self-tests | 10s | **no** |
| Garden lint (packs/registry/prompts) | 10s | **no** |
| Judge calibration drift | 4s | **no** |

The three jobs that are **not** required are precisely the ones that encode the framework's own
shipped guarantees:

- **Framework self-tests** is what FRW-BL-081 added so that "the fix is enforced by a test" stops
  being decorative — before it, CI ran 1 of 34 self-test files and `cost-pricing-guard.test.mjs`
  had never executed once.
- **Garden lint** carries the FRW-BL-082 `pinDrift` assertion, whose entire purpose is to fail CI
  when `settings.json` and `guardrails.md` ISC-3 disagree about the model pin.
- **Judge calibration drift** guards the scoring rubric's fingerprint.

So even with zero bypasses, those guarantees would gate nothing. A guarantee that cannot fail a
push is documentation, not enforcement. Their combined runtime is ~10s wall-clock (they run in
parallel and finish long before the 86s dashboard build), so requiring them costs nothing.

## Standing posture

1. **Required checks should be widened to all six jobs.** Strictly tightens the gate, adds no
   measurable wall-clock, and repairs the FRW-BL-081/082 enforcement gap. This is the change that
   actually matters and it needs no workflow concessions.
2. **The `pull_request` rule is the part to adjudicate**, and it is an operator decision because it
   governs a shareable repo: either drop the review requirement for the maintainer (making the
   status checks the real gate, satisfiable with no bypass), or keep it and accept that every
   autonomous push is a receipted override.
3. **Until (2) is settled, every bypassed push emits a receipt.** Per the § Risk Gating convention
   in `system-instructions.md`, a bypass is an approved override and must leave an audit trail —
   `type: intervention`, naming the ruleset and the checks skipped. An unremarked bypass is what
   produced four sessions of re-noticing.

Applying (1) is a single call, listing all six contexts:

```bash
gh api -X PUT repos/sebwesselhoff/volundr/rulesets/14345267 --input ruleset.json
# required_status_checks.required_status_checks =
#   Typecheck & lint | Build dashboard | Docs & spelling
#   Framework self-tests | Garden lint (packs/registry/prompts) | Judge calibration drift
```

Ruleset mutation is deliberately left to the operator: it changes governance for anyone who clones
or contributes, which is exactly the outward-facing class that § Risk Gating says to confirm rather
than infer.
