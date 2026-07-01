# Volundr Reproducibility Guardrails

This document defines **forbidden settings**, **required settings**, and **pinned model IDs** that keep Volundr's parallel-developer safety model intact across sessions and machines.

---

## ISC-1: `worktree.bgIsolation: none` is FORBIDDEN

**Never set `worktree.bgIsolation` to `none`.**

This setting silently disables worktree isolation for background agents. When isolation is off, every Developer teammate operates against the **shared main checkout** rather than its own isolated worktree branch. The failure mode is subtle and dangerous:

- Multiple agents write to the same working tree concurrently, causing silent file clobbers and merge conflicts that cannot be attributed to a single card.
- `git commit` inside any teammate lands on the branch that happened to be checked out at the time, not the card's feature branch — corrupting branch history.
- The `enforce-worktree-isolation.js` PreToolUse hook loses its ability to distinguish main from a worktree cwd, so its block path may never trigger.

**Worktree isolation MUST remain on.** The correct value (or the absence of the key) leaves isolation active. Do not override it in `.claude/settings.json`, project-level overrides, or `--worktree-isolation` CLI flags.

---

## ISC-2: `worktree.baseRef: head` is REQUIRED under native-CC worktree delegation

**If worktree creation is ever delegated to native Claude Code** (i.e., Claude Code's built-in worktree management rather than the custom `worktree-create.js` hook), you MUST ensure `worktree.baseRef` is set to `head`.

Without this, Claude Code may branch new worktrees from a stale default ref (e.g., the repo's `main` at an old commit), meaning developers start from an out-of-date base and their branches diverge from the intended HEAD state before a single line is written.

This setting is **only relevant under native-CC worktree delegation**. The current Volundr stack uses `worktree-create.js` and explicit `git worktree add` calls, so the base ref is always controlled explicitly. Keep this documented here as a forward-compatibility constraint: if you ever switch to native-CC delegation, add `"worktree.baseRef": "head"` to the relevant config block.

---

## ISC-3: Pinned Default Model IDs

Volundr pins model aliases via environment variables in `.claude/settings.json` to guarantee reproducible behaviour across sessions, machines, and model family bumps.

| Alias env var | Pinned model ID | Role |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-4-8` | High-capability tasks (architecture, planning, adversarial review) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-sonnet-5` | Standard developer and orchestrator tasks |

**When to update:** Update both values here AND in `.claude/settings.json` when the project intentionally moves to a new model family. Never change them mid-sprint — mid-sprint model swaps cause non-reproducible behaviour across cards already in flight.

**How they are consumed:** Any Volundr SDK call or framework script that spawns agents uses these env vars as defaults. Pinning them ensures that a session started today and a session started next week call identical model endpoints, all else being equal.

**Runtime effect requires a restart:** these env vars are read at Claude Code boot (SessionStart), so editing a value here only takes effect on the **next session restart** — it does not re-tier agents already running in the current session. This is also why a family bump must land at a clean boundary (no cards in flight), never mid-sprint.

---

## Summary checklist

| Setting | Required state |
|---|---|
| `worktree.bgIsolation` | MUST NOT be `none` |
| `worktree.baseRef` | `head` — required if using native-CC worktree delegation |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-4-8` (update on intentional family bump) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-sonnet-5` (update on intentional family bump) |
