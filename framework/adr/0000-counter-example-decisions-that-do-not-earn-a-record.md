# 0000 — Counter-example: decisions that do NOT earn a record

**Status:** Reference — not a decision · **Date:** 2026-08-27 · **Card:** FRW-BL-104

Numbered `0000` because it is not a decision and must not consume a real number.

A gate that only ever admits is not a gate. This file exists so the three-condition test is visibly
capable of **excluding**, using real decisions made in this repository that a looser standard would
have written up. If the ADR directory ever fills with entries like these, the gate has stopped
working.

---

## Rejected — `inferAgentType` falls back to `unknown` instead of `developer` (FRW-BL-114)

A real decision with a real rationale: `developer` was the fallback for everything the classifier
could not identify, and `extractSkills` weights persona skill confidence on `developer` rows, so
unclassifiable events silently diluted a real signal.

| Condition | Verdict |
|---|---|
| Hard to reverse | **NO.** It is a default parameter on one function. Reverting is one token, with no migration and nobody to re-consult. |
| Surprising | Mildly. "Do not guess" is the conventional choice, not the contrarian one. |
| Trade-off | Weak. A genuine teammate with an unrecognised name now types `unknown` rather than luckily-correct `developer` — but that was a coin flip, not a capability. |

**Fails on hard-to-reverse, so: no ADR.** The reasoning lives where it is actually needed — in the
function's own docstring, next to the code someone would be reading when they wondered. A journal
entry records that it happened. That is sufficient, and an ADR would add a file without adding a
reader.

## Rejected — the pending-verification register uses the `events` table rather than a new one (FRW-BL-111)

Closer to the line, and worth showing precisely because it is arguable.

| Condition | Verdict |
|---|---|
| Hard to reverse | Partly. Moving to a dedicated table later means a migration — but the register is append-only and derived, so the data ports cleanly. |
| Surprising | Somewhat. A register looks like it wants its own table. |
| Trade-off | **Yes** — richer queries given up in exchange for needing no migration, which is what let the card's own ISC be verified in the session that wrote it. |

**Two of three. Fails the conjunction, so: no ADR.** The rationale is written at length in the
script's header, where the next person to touch it will be. **The gate is `AND`, not "mostly".**
Two-of-three is exactly where an ADR directory starts to bloat, and it is where the discipline has to
hold.

---

## The pattern

Both rejections put the reasoning **next to the code that embodies it** rather than in a separate
document. That is the right default. An ADR earns its separate file only when the reasoning does not
belong to any single file — like `0001`, which is about a GitHub ruleset, a hook, a gate suite and an
operator decision at once, and therefore has no natural home in source.
