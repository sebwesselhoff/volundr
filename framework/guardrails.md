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

## ISC-2: `worktree.baseRef: head` is REQUIRED

**`.claude/settings.json` MUST set `worktree.baseRef` to `head`.** The platform default is
`fresh`, which branches new worktrees from `origin/<default-branch>`.

Volundr's round loop merges each round's teammate branches into **local** `main` before planning
the next round, so local `main` is routinely ahead of `origin`. Under the `fresh` default, a
worktree created for round N+1 branches from the remote — silently discarding every card merged in
rounds 1..N. Developers start from a stale base and their branches diverge before a line is written.

**This is not merely a forward-compatibility constraint.** An earlier revision of this document
claimed the setting was "only relevant under native-CC worktree delegation" because Volundr always
creates worktrees through `worktree-create.js`. That is **false**: the `EnterWorktree` tool creates
worktrees *natively* when inside a git repository (it delegates to `WorktreeCreate` hooks only
*outside* one), and `.claude/hooks/enforce-worktree-isolation.js` actively instructs teammates to
use `EnterWorktree`. Both paths are live, so both must agree on the base ref.

`worktree-create.js` reads the same setting rather than hardcoding a ref, so the hook path and the
native path cannot drift (FRW-BL-083).

---

## ISC-3: Pinned Default Model IDs

Volundr pins model aliases via environment variables in `.claude/settings.json` to guarantee reproducible behaviour across sessions, machines, and model family bumps.

| Alias env var | Pinned model ID | Role |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-5` | High-capability tasks (architecture, planning, adversarial review) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-sonnet-5` | Standard developer and orchestrator tasks |

**Enforced by CI:** `scripts/garden-lint.mjs` parses `ANTHROPIC_DEFAULT_*_MODEL` out of
`.claude/settings.json` and fails if the same literal is absent from the table above. The pin and
its documentation cannot drift apart silently (FRW-BL-082).

**Minimum CLI version:** a pinned model id is only resolvable by a Claude Code build that ships it.
`claude-opus-5` requires **>= 2.1.219** and `claude-sonnet-5` requires **>= 2.1.197**; the floor in
`framework/cc-version-baseline.md` must always be at least the highest requirement of any id pinned
here.

**Opus 5 behavioural deltas** (vs Opus 4.8, relevant to any agent prompt written against 4.8):
adaptive thinking is **on by default** — omitting the `thinking` parameter now thinks, where 4.8 ran
without thinking — and `thinking: disabled` is accepted only at effort `high` or below (pairing it
with `xhigh`/`max` returns HTTP 400).

**When to update:** Update both values here AND in `.claude/settings.json` when the project intentionally moves to a new model family. Never change them mid-sprint — mid-sprint model swaps cause non-reproducible behaviour across cards already in flight.

**How they are consumed:** Any Volundr SDK call or framework script that spawns agents uses these env vars as defaults. Pinning them ensures that a session started today and a session started next week call identical model endpoints, all else being equal.

**Runtime effect requires a restart:** these env vars are read at Claude Code boot (SessionStart), so editing a value here only takes effect on the **next session restart** — it does not re-tier agents already running in the current session. This is also why a family bump must land at a clean boundary (no cards in flight), never mid-sprint.

---

## Summary checklist

| Setting | Required state |
|---|---|
| `worktree.bgIsolation` | MUST NOT be `none` |
| `worktree.baseRef` | `head` — required; the platform default `fresh` discards merged rounds |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-5` (update on intentional family bump) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-sonnet-5` (update on intentional family bump) |
| Claude Code CLI | >= the highest floor any pinned id requires (see `framework/cc-version-baseline.md`) |
