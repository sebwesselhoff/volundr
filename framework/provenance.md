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
  reviewer: who read this before it was allowed to direct tool use here
---
```

In a YAML data file, the same block nests under the item it describes.

**Artifacts require seven fields; notices entries require six.** The extra one is `reviewer`, and
the asymmetry is deliberate: `THIRD-PARTY-NOTICES.md` is the public legal artifact discharging a
copyright obligation, and it has no business naming an internal reviewer. The block on the artifact
is *governance* — it answers "who read this instruction before it was allowed to act here?" The
linter refuses an incomplete block either way, because an incomplete notice looks discharged while
being unusable.

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

## 3. The review step — for INSTRUCTION, which is not what memory-guard covers

This is a different gate from the memory-safety one, and conflating them is the mistake this section
exists to prevent.

`memory-guard` fences **data** — lessons, patterns, journal entries, blueprint excerpts, steering
rules — in nonce-delimited envelopes with an ignore-embedded-instructions preamble and an
HMAC-signed manifest, so an embedded directive cannot act as a command. That machinery works and is
not in question here.

**A skill, prompt or pack artifact is instruction.** It reaches the model to be acted on, and it can
direct tool use. Nothing fences it, and nothing could — fencing instruction so it cannot be acted on
would leave it doing nothing. `memory-loader.js` wraps a poisoned lesson; **nothing wraps a poisoned
skill.**

### The step

Before any third-party-derived instruction artifact enters a pack:

1. **Pin it.** Record the exact upstream commit. A review of "whatever main said that day" is not a
   review of anything retrievable.
2. **Read it in full, adversarially.** Specifically: does it instruct the model to bypass a guard,
   disable a check, exfiltrate anything, or treat its own text as higher-priority than the operating
   manual? Does it declare tool permissions? Does it claim router priority in a way that would
   collide with an existing meta-skill?
3. **Rewrite rather than vendor, wherever possible.** A reimplementation in Volundr's own wording
   against Volundr's own interfaces is reviewable line-by-line and carries no attribution obligation.
4. **Record who reviewed it** in the artifact's `provenance.reviewer` field. The linter fails without
   it, so "nobody is on record" is not a reachable state.
5. **Add the notices entry** if any bytes or recognisable phrasing came across (§1).

### What this buys, stated honestly

Porting converts **continuous** trust in a source that can change under you into a **one-time,
auditable** diff. That is a real and worthwhile improvement over installing.

It does **not** make the content safe. A reviewer can miss something, and a reviewed artifact is
still instruction the model will act on. The honest claim is "trust was made one-time and auditable",
not "this is now safe" — and the weaker true statement matters more than the stronger false one,
because the false one is exactly what would justify skipping step 2.

### Why wholesale installs are refused

Not a style preference. `NousResearch/hermes-agent` ships `optional-skills/security/godmode`: a
ready-to-fire jailbreak with credited techniques from public jailbreak-prompt repositories, aimed at
Claude, GPT, Gemini and Grok. **Installing that repo's skill set installs that**, and it activates on
a description match rather than a deliberate call. `affaan-m/ECC` ships 287 skills of which 286 are
auto-invocable with no runtime router. `addyosmani/agent-skills` warns in its own comparison document
that stacked meta-routers fight over command names — the collision Volundr already had to patch for
`using-superpowers`.

**Port, never install.**

## 4. Enforcement

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
