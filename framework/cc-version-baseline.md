# Claude Code Version Baseline (FRW-BL-026)

Volundr is built on Claude Code's extensibility surface (hooks, settings.json, subagents,
worktrees, skills, MCP). Those primitives are version-gated, so the framework declares a
**minimum supported version** and a feature→version map. `vldr-doctor` checks the running
CLI against this floor.

## Versions

| | Version | Notes |
|---|---|---|
| **Minimum supported** | **2.1.120** | Floor for Volundr's current hook/teammate surface (+ Windows PowerShell-without-Git-Bash, 2.1.120). Below this, hooks/worktree/agent-teams behavior is not guaranteed. |
| **Recommended** | **latest (≥ 2.1.160)** | Required to use the full leverage backlog (see map). Opus 4.8 + ultracode need ≥ 2.1.154. |
| **Detected (this machine)** | **2.1.161** | Recorded 2026-06-02. Newer than the analyzed changelog top (2.1.160) — all researched features available. |

## Feature → version map (what Volundr relies on / wants)

**Currently relied on (must be ≥ minimum):**
- WorktreeCreate / WorktreeRemove hook events — ~2.1.42
- SubagentStart / SubagentStop (+ agent_id, agent_transcript_path) — 2.0.42–43
- Agent tool `isolation: "worktree"` — ~2.1.41
- Windows: PowerShell used when Git Bash absent — 2.1.120
- settings.json `env` block (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, CLAUDE_CODE_EFFORT_LEVEL) — established
- `--dangerously-skip-permissions` bypasses `.claude/` & `.git/` write prompts — 2.1.126 *(relaxation; the launcher relies on it for unattended runs)*

**Leverage backlog requirements (each card should re-state its own floor):**
- `mcp_tool` hooks — 2.1.118 · `alwaysLoad` MCP — 2.1.121 · `--strict-mcp-config` for subagents — 2.1.150
- `parent_agent_id` in hook input / OTEL — 2.1.145 *(FRW-BL-029)*
- Stop-hook 8-block cap — present in current line *(FRW-BL-028)* · native bg worktree-isolation guard *(FRW-BL-027)*
- `skillOverrides` — ~1.9 · skill `disallowed-tools` frontmatter, `MessageDisplay`, SessionStart `sessionTitle`/`reloadSkills` — 2.1.152 *(FRW-BL-033/034)*
- `worktree.bgIsolation` — 2.1.143 · native worktree switching + unlocked cleanup — 2.1.157 *(FRW-BL-027/030)*
- `/goal` completion conditions — current line *(FRW-BL-036)* · `ultracode` / Opus 4.8 — 2.1.154
- `asyncRewake` / `rewakeMessage` background hooks — current official line *(FRW-BL-043 enrichment)*

## Boot smoke-test (run under `--dangerously-skip-permissions`)

Confirms the unattended-run assumptions hold on the running CLI: hooks can write into
`.claude/worktrees` and `post-bash-git.js` git ops fire **without permission prompts**
(v2.1.126 behavior). `vldr-doctor` runs the lightweight version of this; full procedure:

```bash
# 1. CLI version is >= minimum
claude --version            # expect >= 2.1.120

# 2. A worktree write path is reachable (the WorktreeCreate hook writes here)
test -d "$CLAUDE_PROJECT_DIR/.claude" && echo "ok: .claude writable"

# 3. A no-op git command under the running session fires post-bash-git without a prompt
git status --short          # post-bash-git PostToolUse hook runs; no permission prompt
```

**Empirical result (2026-06-02, CLI 2.1.161, this session launched via start.bat with
`--dangerously-skip-permissions`):** PASS — across this session the hooks wrote worktrees
(worktree-create self-test) and `post-bash-git` fired on every commit with **zero permission
prompts**; nine commits landed and migration/test gates ran clean.

## Historical bug clearance (verified on 2.1.161)

The changelog noted three regressions around the autonomous flag; all fix versions are
≤ 2.1.16x, so **2.1.161 includes them** (cleared):
- Flag silently downgraded to accept-edits after a protected-path write — fixed (L1280/L1328).
- Team members not inheriting the leader's permission mode — fixed (L1288).
- (Informational) Stop-hook loops capped at 8 blocks (L362) — a deliberate cap, addressed by FRW-BL-028, not a bug. See **Stop-hook block-cap contract** below.

## Stop-hook block-cap contract (FRW-BL-028)

Claude Code caps **consecutive blocks** from a `Stop` / `SubagentStop` hook at **8**
before it force-ends the turn with a warning (introduced v2.1.143; override via
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, default **8**). A "block" is either `process.exit(2)`
or a stdout `{"decision":"block","reason":"..."}`. There is **no** documented
`{"continue":false,"stopReason":...}` form — do not use it (verified against the official
hooks docs + changelog, 2026-06-02).

**Audit (CLI 2.1.161, 2026-06-02) — no Volundr hook block-retries on a Stop-class event:**

| Hook | Event | Blocks (exit 2 / decision:block)? |
|---|---|---|
| `session-stop.js` | Stop | **No** — exit 0 only |
| `agent-stop.js` | SubagentStop | **No** — exit 0/1 (exit 1 is a fatal error, not a retry block) |
| `teammate-idle.js` | TeammateIdle | Yes — **not Stop-class**, cap does not apply |
| `task-completed.js` | TaskCompleted | Yes — **not Stop-class**, cap does not apply |
| `worktree-create.js` | WorktreeCreate | Yes — **not Stop-class**, cap does not apply |
| `enforce-bash-rules` / `enforce-card-deps` / `enforce-worktree-isolation` / `enforce-worktree-path-write*` | PreToolUse | Yes — **not Stop-class**, cap does not apply |

\* `enforce-worktree-path-write.js` is reduced to logging-only (exit 0) by FRW-BL-027 (same batch); either way it is not Stop-class.

**Decision:** keep the cap at its **default (8)** — do not set `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.
We never intentionally block-retry on a Stop hook, so the default is the correct safety
net against a *future* infinite-loop regression; raising it would only weaken that net.
There are no genuine-halt `exit 2` cases on Stop hooks to migrate. The contract is enforced
by header comments in `session-stop.js` and `agent-stop.js`: those two hooks exit 0/1 only.

**Build-gate retry path:** the build gate retries via `teammate-idle.js` (TeammateIdle
event), which is independent of the Stop cap, so a teammate iterates toward a green build
without the 8-block limit cutting it off. Volundr's post-merge `tsc`/production-build gate
is the backstop if a teammate ever idles with a still-red build.

## Forbidden settings (FRW-BL-027)

| Setting | Forbidden value | Why |
|---|---|---|
| `worktree.bgIsolation` | `"none"` | Silently **disables** Claude Code's native worktree write-isolation guard, letting an Agent-tool subagent's Write/Edit land in the shared checkout (the FRW-BL-022 bug). Leave it at the default `"worktree"`: `enforce-worktree-path-write.js` is advisory-only for those subagents (relies on native), so with `"none"` set they would be **unguarded**. (Teammate writes are still caught by this hook's retained hard block, but do not rely on that — keep the default.) |

The native worktree-isolation guard is on by default and verified ON for Agent-tool
`isolation:"worktree"` subagents on CLI 2.1.161 (subagent coverage fixed in v2.1.154):
a live probe (2026-06-02) had the native guard refuse an out-of-worktree Write with
*"This agent is isolated in the worktree … Edit the worktree copy of this file instead
of the shared-checkout path."* That probe covered the **Agent-tool subagent** surface
only; native coverage of **Agent Teams teammates** (`CLAUDE_AGENT_TEAMS_MEMBER`, a
different launch path — and the surface the original FRW-BL-022 incident hit) is **not
yet live-verified**. So `enforce-worktree-path-write.js` uses **conditional enforcement**:
advisory-only (exit 0) for Agent-tool subagents where native is confirmed, but it
**retains the hard block (exit 2) for teammate contexts** as defense-in-depth. Exactly
one layer acts per call, so there is no double-block / timeout race. (Follow-up: probe
the teammate launch path; if native covers it too, collapse the teammate branch to
advisory.) `enforce-worktree-isolation.js` (the git-commit-to-main PreToolUse:Bash block
— a different surface) is **retained and unchanged**.

## Recommended settings (FRW-BL-034)

| Setting | Recommended value | Why |
|---|---|---|
| `skillOverrides` | `user-invocable-only` | Loads only `user-invocable: true` skills into the model's context by default instead of every discoverable skill — saves context budget on long autonomous runs; model-invocable skills still fire when their description matches. (CC >= 2.1.152 / L676.) |

**Read-only skill hardening (FRW-BL-034):** the query/command `vldr-*` skills (doctor, route,
journal, economy, status, directive) declare `disallowed-tools: Write, Edit` in frontmatter so
they can never mutate the codebase. **Bash is intentionally retained** — these skills `curl` the
dashboard API and run `!`-embedded shell, so disallowing Bash would break them; "read-only" here
means *filesystem* read-only, not no-Bash. `vldr-pack` install ends with a `/reload-skills`
(or `reloadSkills:true`) step so freshly-installed pack skills work without a session restart.
