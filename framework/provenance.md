# Provenance — third-party content entering Volundr

Volundr is MIT (`Copyright (c) 2026 Sebastian Wesselhoff`) and is **redistributed** as a public
Claude Code plugin. That combination is what creates an obligation: MIT permits incorporating other
people's MIT content, but requires that their copyright notice and licence text travel with it.

This document is the convention. `THIRD-PARTY-NOTICES.md` is the register. `scripts/garden-lint.mjs`
is the gate. Prose asking a future session to remember an obligation is not a mechanism — this
project's own anti-pattern list says so — which is why all three exist rather than just the first.

---

## 1. When an entry is required

**Copyright protects expression, not ideas.** Reading how another project solved a problem and then
building your own version is not copying. Reproducing its words, its file, or its data is.

| Situation | Entry required? |
|---|---|
| Upstream **bytes** ship in this repo — a file, a fragment, a data table, a binary | **YES** |
| Upstream text **paraphrased closely enough that the phrasing is recognisable** | **YES** |
| A **mechanism or design** reimplemented in Volundr's own wording against Volundr's own interfaces | No |
| A short factual identifier (a name, a term) with a **freshly written** definition | Attribute anyway |
| Upstream was **read and rejected** | No |

**When it is arguable, attribute.** An unnecessary entry costs four lines. A missing one is a licence
violation in redistributed software. That asymmetry settles every borderline case without further
debate, and it is deliberately not a judgement call left to whoever is in a hurry.

**Reimplementation is the default route.** The standing rule is *port, never install*: adopt the
mechanism, write the code yourself, own it under this repo's review discipline. Most adoption work
therefore produces **no entry at all**, and a sparse register beside a large adoption backlog is the
correct result rather than evidence of sloppiness.

## 2. The marker

A third-party-derived artifact declares its origin inline, so the artifact and the register can be
checked against each other rather than trusted separately.

In markdown frontmatter (skills, prompt templates):

```yaml
---
name: some-ported-artifact
license: MIT
provenance:
  source: owner/repo
  commit: 3c9588880b7cafaec325a104899fd8bbe27e7d72
  license: MIT
  copyright: Copyright (c) 2025 Upstream Holder
  date: 2026-08-27
  taken: what specifically was taken, and how far the derivation goes
---
```

In a YAML data file, the same block nests under the item it describes.

All six fields are required; the linter refuses an incomplete block, because an incomplete notice
looks discharged while being unusable.

`taken` often wants more than one line, so **YAML block scalars are supported** — `taken: |` keeps
the line breaks, `taken: >` folds them into one line, and the chomping forms (`|-`, `>-`) are
accepted. This is worth stating because the naive parse of `taken: |` yields the literal string
`"|"`, which is non-empty and therefore sails through a required-field check while the actual
content is gone. A silent mis-parse of the field that explains how far a derivation goes is the
worst place in this system to have one.

Two field-level rules earn their place:

- **`commit` must be a pin.** A branch name (`main`, `master`, `head`) is rejected. Branches move,
  and a notice pointing at a moving target describes content nobody can retrieve — which is the same
  as no notice.
- **`copyright` is verbatim from the upstream `LICENSE` at that commit** — never inferred from the
  repository URL or the account name. This is not pedantry: `msitarzewski/agency-agents` declares
  `Copyright (c) 2025 AgentLand Contributors`, a project name that does not appear in its URL. An
  attribution file whose first entry names the wrong holder is worse than no file, because it looks
  discharged while being wrong.

## 3. Enforcement

`node scripts/garden-lint.mjs` cross-checks artifacts against the register **in both directions**:

| Finding | Why it is an error |
|---|---|
| Artifact declares provenance, no matching entry | An unmet attribution obligation in redistributed software. |
| Entry matches no artifact | A notice claiming we ship something we do not — a false statement in a legal file. |
| Entry or block missing a required field | Looks discharged, is unusable. |
| `commit` is a branch name | Unretrievable, so the notice is decorative. |
| Artifact and entry disagree on `copyright` | One of them is wrong, and neither is authoritative over the other. |

Matching is on `source@commit`. A different commit does not satisfy an entry — re-taking content
from a newer upstream commit is a new act of incorporation and needs its own pinned entry.

### Known coverage bound — stated, not discovered later

The scanner walks `framework/packs`, `.claude/skills`, `framework/agents`, `framework/personas` and
`framework/skills`, reading `.md` and `.yaml`/`.yml`. That is deliberately the **instruction-shaped**
surface these cards scope to — prompts, skills, packs, persona and trait data.

It therefore does **not** scan `scripts/`, `.claude/hooks/` or `dashboard/`, and it does not read a
provenance marker written as a `//` comment in source code. A ported *code* file would slip past it
today. That is a real gap and it is recorded here rather than left for someone to find as a defect:
covering it needs a comment-form marker and a wider walk, which is its own unit of work. Until then,
**ported code must be attributed by hand** in `THIRD-PARTY-NOTICES.md`, and a reviewer should treat
a new file under `scripts/` that reads like someone else's work as unchecked by this gate.

Coverage theatre is worse than a known gap — so this is the gap, named.

**The scanner reads declarations only from frontmatter or `.yaml`/`.yml` files, never from prose.**
This is designed around a failure this project has now watched four times in a single day
(`FRW-BL-090` and its relatives): a text-scanning gate reading English *about* code as code — a hook
extractor pulling a field out of a comment, `anti-stub-scan` blocking on its own pattern table, the
platform's own guard reading a commit message as a live command. So this document, the notices file,
and the linter's own source are all excluded from the scan, and the self-test asserts those
exclusions rather than assuming them. **Any new text-scanning gate must strip comments and exclude
its own source before its first run**, not after its first false positive.
