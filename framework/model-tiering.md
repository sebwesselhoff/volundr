# Model Tiering — the Map of the Maps (FRW-BL-079)

Volundr decides which Claude model runs where across a few surfaces. They look overlapping but each
governs a **disjoint execution path**, and they all converge on **one** place that turns a tier
*alias* into a concrete model. This doc exists so you don't confuse them or "fix" one by editing
another.

## The single convergence point

Every surface below emits a **bare tier alias** — `opus`, `sonnet`, or `haiku` — and **never** a
version-pinned model id. Aliases resolve to concrete models in exactly one place:

- `.claude/settings.json` env vars `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL`
  pin `opus` / `sonnet`; `haiku` uses Claude Code's built-in default. Documented in
  `framework/guardrails.md` ISC-3.
- **This is the only place concrete version ids (e.g. `claude-sonnet-5`) live.** A model-family bump
  edits only `settings.json` (+ the ISC-3 mirror) — nothing else.

## The surfaces (which one governs which path)

| Surface | Where | Governs | Keyed by |
|---|---|---|---|
| **Teammate / subagent tiering** | `framework/hierarchy-config.ts` → `MODEL_TIERS` | Volundr spawning Agent-tool teammates & subagents (Developers, Architect, QA, Reviewer, …) | agent-type → tier |
| **Native agent files** | `framework/agents/registry.data.mjs` (`model` + `taskDepthTiers`) → `framework/agents/generate-agents.mjs` | Generating `.claude/agents/*.md` frontmatter for native Claude Code agent dispatch (FRW-BL-037) | agent-type → model (+ task-depth tiers) |
| **Workflow-tool scripts** | `framework/workflow-model.mjs` → `WORKFLOW_ROLE_TIERS` (FRW-BL-075) | Sandboxed Workflow-tool `agent()` calls inside workflow scripts | task-**verb** → tier (`locate`, `extract`, `synthesis`, `judge`, `review`, …) |
| **Alias → concrete model** | `.claude/settings.json` + `framework/guardrails.md` ISC-3 | Resolving any bare alias to a concrete model | `opus`/`sonnet`/`haiku` → model id |

### Details that keep them straight

- **`MODEL_TIERS` is the single source of truth for role→tier** on the teammate/subagent path.
  Selection precedence (FRW-BL-031): explicit developer override > registry `taskDepthTiers` >
  `MODEL_TIERS.roles`. The chosen base tier is then adjusted request-aware by
  `framework/scenario-router.mjs` (FRW-BL-059) and stepped down as the run's token budget depletes by `scripts/budget-controller.mjs` (FRW-BL-053); economy downgrade / "Use Opus for {X}" escalation
  is applied **by Volundr when it picks the spawn param** (one tier down, floored at haiku, `volundr`
  lead exempt — see `system-instructions.md` § model selection), not by a post-hoc resolver.
- **The registry path normalizes to the same aliases.** `generate-agents.mjs` runs `shortModel()`
  over each registry `model` (`opus-4` → `opus`, `sonnet-4` → `sonnet`, `haiku-4` → `haiku`) before
  writing the `.claude/agents/*.md` frontmatter, so its legacy tier ids collapse to the same bare
  aliases and resolve via the same `settings.json` pins. `taskDepthTiers` (task-size → tier) is the
  orthogonal depth layer that feeds the middle precedence slot above.
- **The workflow map is a different namespace.** `WORKFLOW_ROLE_TIERS` is keyed by workflow task
  *verbs*, not agent personas, and it governs only sandboxed Workflow-tool scripts. Workflow scripts
  can't import the TS config, so it mirrors the tier order locally and authors inline the map.

## Why these are separate (not a duplication to collapse)

The three role/verb maps look redundant but aren't: they sit on **different actors and mechanisms**
— (A) Volundr spawning teammates via the Agent tool, (B) native Claude Code agent files generated
from the registry, (C) sandboxed Workflow-tool scripts (which physically cannot import the TS
config). No two of them ever decide the same spawn, and all normalize to the same alias set + the
same `settings.json` pins, so they cannot conflict.

> The one surface that *was* a genuine duplicate — `framework/model-resolution.ts`, an unwired
> resolver that re-encoded `MODEL_TIERS` and drifted — was deleted in FRW-BL-078. If you feel the
> urge to add a "central model resolver," that's the trap: the map (`MODEL_TIERS`) plus the
> documented economy rule already are the resolver, applied by Volundr at spawn.

## Rule of thumb — where to edit

| You want to change… | Edit |
|---|---|
| What tier a spawned **teammate/subagent** gets | `MODEL_TIERS.roles` in `framework/hierarchy-config.ts` |
| A native **`.claude/agents/*.md`** agent's model / depth tiers | `framework/agents/registry.data.mjs`, then regenerate via `generate-agents.mjs` |
| A **workflow-script** role's tier | `WORKFLOW_ROLE_TIERS` in `framework/workflow-model.mjs` (+ the inline map in the workflow-authoring guidance) |
| What a tier **alias resolves to** (a model-family bump) | `.claude/settings.json` (+ `framework/guardrails.md` ISC-3) — the **only** place concrete versions live |
