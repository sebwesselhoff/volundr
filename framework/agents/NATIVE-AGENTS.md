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

Generated defs enable native Claude Code dispatch — no prose role-priming needed.
Registration is **file-based** (there is *no* settings.json registration field — see below).
Scope priority (official `sub-agents.md` table; highest wins on a name clash):

| Registration location | Scope | Priority |
|---|---|---|
| Managed settings (`.claude/agents/` in the managed-settings dir) | Organization | 1 (highest) |
| `--agents '<json>'` CLI flag | Current session only | 2 |
| `.claude/agents/<name>.md` | Current project (**what Volundr generates**) | 3 |
| `~/.claude/agents/<name>.md` | All your projects | 4 |
| A plugin's `agents/` directory | Where the plugin is enabled | 5 (lowest) |

- **CLI (primary):** `claude --agent <name>` (e.g. `claude --agent reviewer`,
  `claude --agent developer`). `<name>` matches the def's `name` frontmatter, which is the
  file basename. Volundr's `.claude/agents/*.md` defs register at **project scope** (row 3).
- **Session-only CLI:** `claude --agents '<json>'` accepts the same frontmatter fields as a
  file def (`description, prompt, tools, disallowedTools, model, permissionMode, mcpServers,
  hooks, maxTurns, skills, …`) for ad-hoc/automation use; not persisted to disk.
- **Task / `subagent_type` dispatch:** the in-session delegation path resolves these same defs.
- **No settings.json `agents` registration field.** *(Corrected in FRW-BL-070 — an earlier
  draft of this section claimed a plural `agents` field existed; it does not.)* The official
  `settings.json` key list has **no plural `agents` key**. The only related key is the
  **singular `agent`**, which merely *runs the main thread as a named subagent / sets the
  default agent for `claude agents` sessions* — it **references** an already-registered
  filesystem def, it does **not** register or define one.

Native dispatch means the read-only roles enforce their guardrails **in the CLI**:
`architect`, `guardian`, and `reviewer` carry `permissionMode: plan` and omit
`Write`/`Edit` from `tools`, so the platform — not a prose instruction — prevents
mutation. See `framework/cc-version-baseline.md` for the CC version floors
(`permissionMode`, `--agent`, the frontmatter fields).

### Verified (FRW-BL-070): read-only Bash is never gated; the tools allowlist is the real guardrail

The FRW-BL-037 review left an open worry: do `permissionMode: plan` roles (`guardian`,
`reviewer`, `architect`) — which keep `Bash` in `tools` for read-only audit — get their Bash
calls **gated**, blocking autonomous review? **No** — and the precise mechanism matters:

- **Docs (the authority):** Claude Code has a **universal built-in read-only command set**
  (`ls`, `cat`, `grep`, `find`, `diff`, `echo`, **read-only forms of `git`** like
  `status`/`log`/`diff`, …) that runs **without a permission prompt in _every_ mode**, including
  `plan` and `default` (`permissions.md` § read-only commands; `permission-modes.md`). Read-only
  Bash is therefore never gated for these roles regardless of `permissionMode`. (Write-capable
  git — `checkout`, `reset --hard`, `push` — is **not** in that set and would prompt
  interactively.) Plan mode is **not** specially permissive for Bash; what it adds over `default`
  is an **edit/write block**, not a Bash grant.
- **Live probe (the restart 070 was gated on):** a subagent on the real `reviewer` def
  (`permissionMode: plan`) and a generic plan-mode agent each ran `git log -1` / `git status` —
  **both EXECUTED, no prompt, no block.** A control **write**-probe in plan mode **also**
  executed, which tells us this session runs under `--dangerously-skip-permissions` (the
  documented unattended-run mode — see `cc-version-baseline.md`): that flag bypasses plan mode's
  edit-block, so the live probe confirms read-only Bash works **in Volundr's actual operating
  mode** but cannot isolate plan-mode-specific gating — the **docs** are the authority for that.

**What this means for the guardrail.** Because (i) read-only Bash is exempt in all modes and
(ii) `--dangerously-skip-permissions` bypasses plan mode's edit-block, the **load-bearing
read-only guardrail for these roles is the tools allowlist** — `Write`/`Edit`/`NotebookEdit` in
`disallowedTools`, so the mutating tool simply isn't available. `permissionMode: plan` is
**defense-in-depth** that adds an edit-block **only when not** running skip-permissions; keep it
(it costs nothing and protects interactive use), but do not treat it as the primary mutation
guard. No `ExitPlanMode` call is needed — a read-only audit agent just returns findings.
**Net:** the current `permissionMode: plan` + `Bash` + `Write`/`Edit`-disallowed config is
correct as-is; no def change and no "non-blocking read-only Bash" workaround is needed.
Evidence + probe transcripts: `reports/FRW-BL-070-report.md`.

### Plugin-packaging caveat (forward-constraint for FRW-BL-041)

A plugin's `agents/` directory is a registration surface (row 5 above), but the platform
**strips three frontmatter fields from plugin subagents for security — `permissionMode`,
`mcpServers`, and `hooks` — they are ignored at load time** (`sub-agents.md` → plugin
subagents note). So if FRW-BL-041 were to ship `guardian`/`reviewer`/`architect` **inside the
plugin**, they would silently **lose `permissionMode: plan` and their pack `mcpServers`** (the
`researcher`'s Atlassian/Playwright servers, etc.). The mutation guardrail still holds via the
**tools allowlist** (`Write`/`Edit` in `disallowedTools`), but the plan-mode defense-in-depth
layer and native MCP wiring do **not** survive plugin packaging. **Decision recorded for 041:**
keep the read-only / MCP-bearing native defs in `.claude/agents/` (project scope); do **not**
rely on the plugin `agents/` dir for any def whose behavior depends on
`permissionMode`/`mcpServers`/`hooks`.

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
