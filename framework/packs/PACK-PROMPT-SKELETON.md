# Pack Prompt Skeleton (FRW-BL-062)

The canonical standard for **every pack prompt template** under
`framework/packs/*/prompts/*.md`. It exists so that (a) each template shares the
same backbone and (b) the orchestrator can resolve declared sub-skill
dependencies and typed inputs from a machine-readable contract.

There are two parts:

1. A **shared skeleton** — four required Markdown sections every template must
   contain (`## Role`, `## When Invoked`, `## Quality Checklist`,
   `## Handoff Context`).
2. A **declarative contract** — a typed block (documented here as `## Contract`
   in the template) whose machine-readable source of truth lives in the pack
   manifest's top-level `contracts` object (`framework/packs/<pack>/pack.json`).

The reference implementations are the three CORE templates:
`prompts/developer-teammate.md`, `prompts/architect-teammate.md`,
`prompts/reviewer-teammate.md`.

> This is a **structural/labeling** standard. Adopting it must NEVER drop
> behavioral content (rules, the FRW-BL-023 Output Discipline block,
> worktree-isolation rules, SendMessage rules). Map existing sections into the
> skeleton; do not rewrite their meaning.

---

## 1. The shared skeleton (four required sections)

Every pack prompt template MUST contain these four sections, in this order
relative to one another (other sections — Identity, Context, ISC, Rules, Output
Discipline, Traits — may appear between or around them; they are preserved
verbatim from the existing templates):

### `## Role`
One short paragraph: who the agent is and what it owns. Maps from the existing
opening "You are a …" identity sentence.

### `## When Invoked`
A **numbered list** of the concrete steps the agent runs once spawned. Maps from
the existing "Execution Protocol" / "Your Protocol" / spawn-pattern steps. Keep
every step; only relabel the heading.

### `## Quality Checklist`
A checklist (`- [ ]` items) the agent verifies before declaring a card/task
done. Maps from the existing "Self-Review Checklist" (or, for reviewers, the
severity rubric / security checklist).

### `## Handoff Context`
The structured report the agent sends back via `SendMessage` (the DONE / Branch
/ Files block, or the reviewer's BLOCK/WARN/INFO verdict). Maps from the existing
"Reporting" section. This is the deliverable — keep its format exact.

---

## 2. The `## Contract` block (template-side)

Each template gains a `## Contract` section that **declares** its contract in
human-readable form and points at the machine-readable source in `pack.json`.
Three fields:

- **Required sub-skills** — skills that MUST resolve for this agent type
  (transitive; resolved by the resolver). May be empty.
- **Optional sub-skills** — skills offered but not mandatory.
- **Inputs** — a typed table: `name`, `type`, `required`, `default`.

Template-side example (human-readable):

```
## Contract

Declared in `framework/packs/core/pack.json` → `contracts.developer`.

- **Required sub-skills:** none
- **Optional sub-skills:** test-driven-development, systematic-debugging

| Input       | Type   | Required | Default  |
|-------------|--------|----------|----------|
| DOMAIN      | string | yes      | —        |
| MODEL       | string | no       | sonnet-4 |
| CONSTRAINTS | string | no       | ""       |
```

---

## 3. Machine-readable form (in `pack.json`)

The source of truth is a top-level `"contracts"` object in the pack manifest,
keyed by `agentType`. Each contract has exactly three keys:

```json
"contracts": {
  "developer": {
    "requiredSkills": [],
    "optionalSkills": ["test-driven-development", "systematic-debugging"],
    "inputs": {
      "DOMAIN":      { "type": "string", "required": true },
      "MODEL":       { "type": "string", "default": "sonnet-4" },
      "CONSTRAINTS": { "type": "string", "default": "" }
    }
  }
}
```

Schema (keep it simple and internally consistent):

- `requiredSkills`: `string[]` — sub-skill names resolved transitively.
- `optionalSkills`: `string[]` — sub-skill names, not resolved as deps.
- `inputs`: object keyed by input name. Each value is an **InputSpec**:
  - `type`: `string` (declared type, informational).
  - `required`: `boolean` (omit or `false` for optional).
  - `default`: fixed default value (omit when there is no default).

An input should declare `required: true` **or** a `default`, not both — a
required input has no default; a defaulted input is not required.

---

## 4. How the resolver consumes it

`framework/agents/skill-resolver.mjs` (pure Node ESM, no deps) is the orchestrator
hook. It exports:

- `loadContracts(packManifest)` → the `contracts` map (or `{}`).
- `resolveInputs(contract, providedInputs)` →
  `{ resolved, missingRequired }`. Fills fixed defaults for absent inputs,
  keeps caller-provided values, and lists required inputs that were not
  supplied. The orchestrator uses `missingRequired` to refuse a spawn that lacks
  a mandatory input (e.g. `DOMAIN`).
- `resolveSubSkillDeps(agentType, contractsByType)` →
  `{ skills, cycle }`. Walks `requiredSkills` transitively in a stable
  (deterministic, post-order) sequence so a dependency precedes its requirer,
  de-duplicates shared deps, and is cycle-safe — on a back-edge it stops and
  returns the offending `cycle` path instead of looping forever.

This contract resolution is **purely additive**: it does not touch — and must
not change — the retry / round / quality-gate logic. Adopting the skeleton is a
labeling exercise; wiring the resolver is a read-only consumer of declarative
data.
