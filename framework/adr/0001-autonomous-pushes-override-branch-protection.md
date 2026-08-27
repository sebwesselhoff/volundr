# 0001 — Autonomous pushes override the `main` branch-protection ruleset

**Status:** Accepted · **Date:** 2026-08-11 · **Card:** FRW-BL-091
*Retrofitted 2026-08-27 (FRW-BL-104). The reasoning already existed in `framework/branch-protection.md`
— an ADR created by accident, which is the evidence that this mechanism was wanted.*

## Gate

- **Hard to reverse:** yes. Reversing means either satisfying the ruleset (impossible for a
  single-maintainer repo — it demands a non-author approving review) or removing the ruleset and
  giving up the protection on the human path too. Neither is a flag flip.
- **Surprising:** yes, and demonstrably so — it was re-derived across **four separate sessions**
  before being written down, because "the guard is being bypassed" reads as a defect every time
  someone new encounters it.
- **Trade-off:** yes, and it is sharp. Enforcement moves off the server and onto a local gate suite,
  which means it is only as good as the discipline running it.

## Context

`main` is guarded by a repository **ruleset** — not classic branch protection. This matters
practically: the classic protection endpoint 404s, which is why the guard has repeatedly looked
*absent* when checked the obvious way.

The ruleset's `pull_request` rule requires a non-author approving review. Volundr runs autonomously
in a single-maintainer repository. There is no second human to approve, so the rule is unsatisfiable
by construction rather than merely inconvenient.

## Decision

**The ruleset stays, and autonomous pushes override it.** Taken by the operator on 2026-08-11, to
keep the autonomous loop sleek. **Do not re-litigate this each session, and do not treat a bypass as
a defect.**

## What we gave up

Server-side enforcement on the autonomous path. Required status checks are **skipped wholesale** on a
bypassed push, so CI is not a safety net for those commits — it reports after the fact, on code
already on `main`.

## Consequences

Two, and they are the load-bearing part:

1. **The pre-commit gate suite IS the gate.** It must be run against the working tree before every
   commit and never inferred from an earlier run. There is no server-side second chance.
2. **Every push MUST leave a `type: intervention` receipt** naming the ruleset and the skipped
   checks. Automated in `.claude/hooks/post-bash-git.js`. An unremarked bypass is precisely what
   produced four sessions of re-noticing the same thing — the receipt is what converts an invisible
   override into an auditable one.

A related trap, recorded because it cost a session: that hook was originally registered with matcher
`Bash` only, so it never fired for the **PowerShell** tool — the primary shell on Windows — and the
first real push of one session produced no receipt at all (FRW-BL-092).

Facts, measured check runtimes and the full rationale: `framework/branch-protection.md`.
