# Architecture Decision Records

A journal entry answers *"what happened on Tuesday?"*. An ADR answers *"why is it like this?"* — and
that second question is the one that gets asked months later, by someone who has no idea which
Tuesday to look under.

Volundr already records decisions two ways: `entryType: 'decision'` journal entries, and commit
bodies. Both are **chronological streams**, which makes them good for session continuity and bad for
retrieval: the answer exists, but it is filed under *when* rather than under *what it explains*.

**The cost is already measurable in this project's own history.** The branch-protection posture took
**four sessions** to settle, largely because the reasoning lived in journal entries that each session
had to re-read and re-derive — until FRW-BL-091 finally wrote it into `framework/branch-protection.md`.
That file is an ADR created by accident. This directory is the same thing on purpose.

---

## The gate — three conditions, ALL required

A decision earns a record only if it is **all three** of:

| Condition | Test | Why it matters |
|---|---|---|
| **Hard to reverse** | Undoing it means changing several things, migrating data, or re-litigating with someone else. | A one-line change that can be flipped back tomorrow does not need a durable record — the code IS the record. |
| **Surprising** | A competent engineer arriving fresh would plausibly do the opposite. | If the choice is what anyone would do anyway, an ADR restates the obvious and dilutes the ones that matter. |
| **Carries a real trade-off** | Something genuine was given up, and you can name it. | "We chose the better option" is not a decision, it is a preference. If nothing was sacrificed, there was no decision to record. |

**Applied honestly, most decisions FAIL this gate — that is the point.** The failure mode for ADRs is
not too few, it is a directory of eighty files nobody opens because most of them are diary entries.
A counter-example is worked through in `0002` precisely so the gate is visibly capable of excluding.

## Relationship to journal decision entries — they do not duplicate

They answer different questions and both stay:

| | Journal `decision` entry | ADR |
|---|---|---|
| **Question** | what was decided, and when | why it is this way, and what it cost |
| **Shape** | chronological stream | filed under the thing it explains |
| **Lifetime** | session continuity — read at the next boot | durable — read in six months |
| **Volume** | every non-trivial choice | only what passes the three-condition gate |

**The rule:** the journal entry is always written; the ADR is written *additionally* when the gate
fires, and the journal entry links to it. Never write an ADR *instead of* a journal entry — the boot
sequence reads the journal, not this directory, so a decision recorded only here is invisible to the
next session's context load.

## Format and location

One file per decision, `framework/adr/NNNN-kebab-title.md`, numbered sequentially and **never
renumbered** (a stable id is the whole value of filing under a number). Superseding does not delete:
mark the old one `Superseded by NNNN` and leave it, because the reasoning that was *wrong* is often
what stops it being re-proposed.

```markdown
# NNNN — Title stating the decision, not the topic

**Status:** Accepted | Superseded by NNNN | Reversed (see NNNN)
**Date:** YYYY-MM-DD · **Card:** FRW-BL-NNN

## Gate
- Hard to reverse: ...
- Surprising: ...
- Trade-off: ...

## Context
What forced a decision. The situation, not the answer.

## Decision
What was decided, in one or two sentences, in the active voice.

## What we gave up
The named cost. If this is empty the gate was misapplied.

## Consequences
What is now true that was not before — including the bad parts.
```

Title the decision, not the topic: *"Autonomous pushes override the branch-protection ruleset"*, not
*"Branch protection"*. A reader scanning the directory should be able to tell what was decided
without opening anything.

## The glossary question — decided, not shared (FRW-BL-104 ISC-5 / FRW-BL-099)

`FRW-BL-104`'s source pairs a gate like this one with a **living glossary**, and `FRW-BL-099` needs a
glossary of its own for terminology-drift detection. The obvious move is one glossary serving both,
on the reasoning that two glossaries will disagree.

**Decided: they are NOT shared, because they are different scopes** — and the disagreement the
sharing was meant to prevent cannot arise between them.

- `FRW-BL-099`'s glossary is **per-project**: the nouns of one `blueprint.md`, used to detect drift
  between that blueprint, its SoWs and its cards. It is meaningless outside that project.
- An ADR glossary would be **framework-wide**: terms like *worktree isolation*, *build gate*,
  *steering rule*.

A single glossary would have to be one or the other. Per-project makes it useless for framework ADRs;
framework-wide makes it useless for the drift detection `FRW-BL-099` exists to do. They do not overlap
enough to disagree.

**So: ADRs define their terms inline where a term is load-bearing, and `FRW-BL-099` owns a
per-project glossary derived from the blueprint.** Recorded here so `FRW-BL-099` does not re-open it.

## Scope

**In:** the record format, the gate, where ADRs live.
**Out:** retrofitting the 90+ completed cards — this is not an archaeology project. Retrofit a past
decision only when someone actually goes looking for it and finds only a timeline.
