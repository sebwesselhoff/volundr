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

## Decision (settled 2026-08-11)

**The `pull_request` rule stays, and autonomous pushes are accepted as receipted overrides.**
Operator decision; rationale: keep the autonomous loop as sleek as possible. Waiting on a review
that no second person can give — or on a ~95s CI run — at every card close buys nothing on a
single-maintainer repo, and the override is now self-documenting rather than silent.

State the trade plainly so nobody re-derives it later: **`main` is not gate-protected in practice.**
The ruleset stands as a guard on anything arriving by pull request, not as a gate on the
maintainer's own pushes.

### Correction to an earlier claim in this document

An earlier revision argued that widening `required_status_checks` from three contexts to all six was
"the change that actually matters". With overrides accepted that overstated it: **required checks are
skipped wholesale on a bypassed push**, so widening changes nothing for the autonomous flow. Its
remaining value is real but narrower — it hardens the **pull-request** path, so an external
contributor's PR would also have to satisfy Framework self-tests, Garden lint and Judge calibration
drift, which is where the FRW-BL-081/082 guarantees become enforceable for anyone but the maintainer.

Widening is therefore **optional repo-hardening, not a loose end** in the autonomous workflow. It
costs the maintainer nothing (their pushes bypass regardless) and is a single call:

```bash
gh api -X PUT repos/sebwesselhoff/volundr/rulesets/14345267 --input ruleset.json
# required_status_checks.required_status_checks =
#   Typecheck & lint | Build dashboard | Docs & spelling
#   Framework self-tests | Garden lint (packs/registry/prompts) | Judge calibration drift
```

Ruleset mutation stays an operator action: it changes governance for anyone who clones or
contributes, which is exactly the outward-facing class that § Risk Gating says to confirm rather
than infer.

## What is load-bearing now

Because the ruleset does not gate the maintainer's pushes, two things carry the weight the gate
otherwise would, and must not be quietly dropped:

1. **The pre-commit gate suite IS the gate.** All self-tests, garden-lint, plugin validation,
   judge-calibration, dashboard typecheck, production build, and cspell on changed markdown — run
   against the working tree before committing, never inferred from an earlier run.
2. **Every push emits a receipt** (`type: intervention`, naming the ruleset and the skipped checks),
   emitted automatically by `.claude/hooks/post-bash-git.js`. A mechanism rather than prose asking
   the lead to remember, because an unremarked bypass is precisely what produced four sessions of
   re-noticing the same thing.
