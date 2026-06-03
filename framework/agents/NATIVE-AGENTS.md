# Native Claude Code Agent Definitions (FRW-BL-037)

`.claude/agents/*.md` are the native Claude Code agent-definition files. As of
FRW-BL-037 they are **GENERATED from the registry** — they are no longer
hand-maintained, so they can never drift from `framework/agents/registry.ts`
again. (They previously drifted: their body pointers said
`framework/agents/prompts/…`, but the real prompt templates live at
`framework/packs/<pack>/prompts/…`.)

> **DO NOT hand-edit `.claude/agents/*.md`.** Edit the data, then regenerate.

## (a) The pipeline — single source of truth

```
framework/agents/registry.data.mjs   ← SINGLE SOURCE OF TRUTH (plain-JS data)
        │  (imported + re-exported, typed, by)
        ▼
framework/agents/registry.ts          ← typed view; preserves AGENT_REGISTRY, AGENT_REGISTRY_LIST,
        │                                AgentTypeDefinition, TOKEN_ESTIMATES, WORKER_LIMITS, …
        │  (read by)
        ▼
framework/agents/generate-agents.mjs  ← pure-Node generator (no tsc/node_modules)
        │  + each agent's pack framework/packs/<pack>/.mcp.json (mcpServers)
        ▼
.claude/agents/<name>.md              ← GENERATED native defs (frontmatter + body pointer)
```

**The data split** (`registry.data.mjs` holding the `AGENT_REGISTRY_DATA` object,
`registry.ts` importing + re-exporting it typed) is what makes the registry
*executable*: the data is now consumable by bare `node` (no `tsc`/`ts-node`,
which the isolated worktrees do not have). `hierarchy-assessor.ts` and any other
TS consumer still `import { AGENT_REGISTRY_LIST } from './agents/registry.js'`
exactly as before — the export surface is unchanged.

### Regenerate / drift-gate

```bash
node framework/agents/generate-agents.mjs          # write the defs
node framework/agents/generate-agents.mjs --check    # exit 1 if regen would change a file (CI gate)
node framework/agents/generate-agents.test.mjs      # self-test (0 failed → exit 0)
```

The generator is **deterministic and idempotent** — running it twice yields
byte-identical files (stable key order, LF endings, trailing newline). Wire
`--check` into CI so a hand-edit (or a registry change without a regen) fails the
build.

### What each frontmatter field comes from

| Frontmatter field | Source in `registry.data.mjs` |
|---|---|
| `name` | the def's output basename (== `customizationKey`; registry key `review` → `reviewer`) |
| `description` | `def.description` |
| `model` | `def.model`, shortened (`sonnet-4`→`sonnet`, `opus-4`→`opus`, `haiku-4`→`haiku`) |
| `tools` | `def.tools` + team-coordination tools for teammates (see below) |
| `disallowedTools` | complement of `tools` over `{Agent,Bash,Write,Edit,NotebookEdit}` |
| `permissionMode` | `def.permissionMode` — `plan` on read-only roles |
| `maxTurns`, `effort`, `memory`, `skills`, `initialPrompt` | the matching `def.*` field (emitted only when set) |
| `isolation` | `def.isolation` (`worktree` for developer) |
| `mcpServers` | the agent's pack `framework/packs/<pack>/.mcp.json` `mcpServers` (verbatim, when present) |
| body pointer | `def.promptTemplate` (the CORRECT pack path) |

Team-coordination tools: write-capable teammates get
`SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet`; read-only teammates
(`permissionMode: plan`) get the read-only subset `SendMessage, TaskList, TaskGet`;
Agent-tool subagents (e.g. `fixer`) get none.

### Which agents get a native def (the spawnable set)

The set is declared in **one place** — `NATIVE_AGENTS` in `generate-agents.mjs`.
It currently emits 9 defs: `architect, designer, developer, devops-engineer,
fixer, guardian, qa-engineer, researcher, reviewer` (`reviewer.md` ← registry key
`review`).

Excluded, and why:

- `volundr` — the team **lead** itself, not a spawnable teammate def.
- `planner` — Agent-tool subagent that returns JSON; dispatched via its prompt template.
- `roundtable-voice`, `chaos-engine-voice` — **temporary** roundtable-only voices.
- `developer-subagent` — flat-mode Agent-tool variant of `developer` (same template family).
- `tester`, `content` — file-only Agent-tool subagents; dispatched via prompt template.
- `debugger`, `performance-engineer`, `security-auditor` — FRW-BL-056 roles not yet
  promoted to native defs (kept template-dispatched for now).

To add an agent to the native set later, add one `{ type, file }` entry to
`NATIVE_AGENTS` and regenerate.

## (b) Native dispatch (ISC-3)

Generated defs enable native Claude Code dispatch — no prose role-priming needed:

- **CLI:** `claude --agent <name>` (e.g. `claude --agent reviewer`,
  `claude --agent developer`). The `<name>` matches the def's `name` frontmatter,
  which is the file basename.
- **settings `agents` field:** reference a def by name in `settings.json` (the
  `agents` registration field) so a teammate is launched with that def's
  frontmatter (model, tools, `permissionMode`, `mcpServers`, …) applied natively.

Native dispatch means the read-only roles enforce their guardrails **in the CLI**:
`architect`, `guardian`, and `reviewer` carry `permissionMode: plan` and omit
`Write`/`Edit` from `tools`, so the platform — not a prose instruction — prevents
mutation. See `framework/cc-version-baseline.md` for the CC version floors
(`permissionMode`, `--agent`, the frontmatter fields).

## (c) Back-compatibility path (ISC-5)

**The existing prompt-template dispatch still works, unchanged.** Volundr can
continue to spawn a teammate/subagent by filling the prompt template at
`framework/packs/<pack>/prompts/<role>.md` (the `def.promptTemplate`) — the
native def's body simply *points at that same template*. Nothing about the
template flow changed: the generated `.claude/agents/*.md` files are an
**additive** native-dispatch surface layered on top of the unchanged
template-dispatch surface. Teams on a CLI below the feature floor, or any flow
that prefers prompt-template priming, keep working with zero changes.

Both paths read from the same registry, so they cannot disagree about a role's
model/tools/template.

## (d) The `whenToUse` delegation tiebreaker (ISC-7)

Each def emits a **When to use** line from the registry's `whenToUse` cue. This is
the natural-language **routing tiebreaker** introduced in FRW-BL-057 and already
consumed by routing (see `framework/system-instructions.md` → "Spawn teammates
using registry routing"): when a card's signals keyword-match more than one agent
type (e.g. `developer` vs `developer-subagent`, `qa-engineer` vs `tester`,
`review` vs `guardian`), pick the agent type whose `whenToUse` best fits the
card's actual shape (card count, shell needs, milestone vs in-flight). Emitting
it into each native def makes the same cue visible to the platform's own
agent-selection at dispatch time.
