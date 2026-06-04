# Volundr as a Claude Code Plugin (FRW-BL-041)

Volundr ships as an installable Claude Code **plugin** in addition to its primary
dev-repo form. The packaging is **purely additive**: it layers on top of the
existing `.claude/settings.json` wiring without changing it, so the dev repo keeps
working exactly as before and the plugin install is a separate distribution surface.

## What the plugin provides

| Component | Source (relative to plugin root) | Manifest field | Discovery |
|---|---|---|---|
| Skills (`vldr-*`) | `./.claude/skills/<name>/SKILL.md` (10 skills) | `skills` (additive) | namespaced `volundr:<skill>` |
| Commands | `./.claude/commands/*.md` (2) | `commands` (replaces default) | namespaced `volundr:<command>` |
| Lifecycle hooks | `./hooks/hooks.json` → `${CLAUDE_PLUGIN_ROOT}/.claude/hooks/*.js` | `hooks` | loads at session start |
| Packs (data) | `framework/packs/*` | — (bundled repo files) | read by skills/SDK relative to plugin root |

Manifests:
- `.claude-plugin/plugin.json` — the plugin manifest (name `volundr`).
- `.claude-plugin/marketplace.json` — a self-marketplace (name `volundr`) listing the
  plugin with `source: "./"`, so the repo is installable directly.
- `hooks/hooks.json` — plugin hook registration mirroring `.claude/settings.json`, but
  via `${CLAUDE_PLUGIN_ROOT}` so an installed copy self-locates its hook scripts.

## Install

```bash
# from a checkout / local path:
claude plugin marketplace add /path/to/volundr      # or:  claude plugin marketplace add sebwesselhoff/volundr
claude plugin install volundr@volundr               # plugin@marketplace
# hooks/MCP take effect next session (or /reload-plugins mid-session)
```

Update: `claude plugin marketplace update volundr && claude plugin update volundr`
(restart to apply hook/MCP changes).

## Verify

```bash
claude plugin validate . --strict                   # authoritative local check (plugin + marketplace)
node framework/plugin/validate-plugin.mjs            # dependency-free CI gate (also self-tested)
node framework/plugin/validate-plugin.test.mjs       # proves the validator fails on broken manifests
```

The pure-node validator (`framework/plugin/validate-plugin.mjs`) is wired into CI
(`.github/workflows/ci.yml`, `garden` job) because GitHub runners do not ship the
`claude` CLI. It checks: `plugin.json`/`marketplace.json`/`hooks.json` are valid JSON,
the plugin name is kebab-case, every component path (skills/commands/hooks) exists, the
marketplace self-entry agrees with `plugin.json`, and **every `${CLAUDE_PLUGIN_ROOT}`
hook-script reference resolves to a real file** — so a dangling hook path fails the build.

## Deliberate scope decisions

1. **`.claude/settings.json` is left untouched (non-destructive).** The dev repo's hooks
   continue to load from `settings.json` via `${CLAUDE_PROJECT_DIR}`; the plugin's
   `hooks/hooks.json` is a parallel surface via `${CLAUDE_PLUGIN_ROOT}`. This is the
   anti-brick guarantee: a restart re-verifies the dev-repo hooks unchanged, and the
   plugin path is exercised only when the plugin is actually installed.

2. **Do NOT install the Volundr plugin into the Volundr dev repo itself.** Plugin hooks
   and `settings.json` hooks **compose additively** (both run) — installing the plugin in
   the dev checkout would double-fire every hook. Use the dev repo *or* the installed
   plugin, not both in the same project.

3. **Agents are NOT shipped in the plugin `agents/` field.** Per FRW-BL-070, Claude Code
   **strips `permissionMode`, `mcpServers`, and `hooks` from plugin subagents** for
   security. Volundr's read-only roles (`guardian`/`reviewer`/`architect`) depend on
   `permissionMode: plan`, and `researcher` depends on pack `mcpServers` — shipping them as
   plugin agents would silently drop those. The native defs therefore remain generated into
   project-scope `.claude/agents/` (see `framework/agents/NATIVE-AGENTS.md`). The mutation
   guardrail (tools allowlist: `Write`/`Edit` in `disallowedTools`) is unaffected either way.

4. **Packs bundle as repo files.** `framework/packs/*` travel with the plugin (the plugin
   root is the repo root) and are resolved by skills/SDK relative to the plugin root; no CC
   plugin "pack" component type exists, so there is no manifest field for them.

## Verification status

Verified this card (no second environment needed):
- `claude plugin validate . --strict` parses and accepts the plugin and marketplace manifests
  (the plugin-manifest pass emits one advisory — the CLAUDE.md note below).
- `node framework/plugin/validate-plugin.mjs` (CI gate) + its 11-case self-test pass, including a
  **full structural hook-parity** check: `hooks/hooks.json` is byte-identical to
  `.claude/settings.json` after env-token normalization (matcher / `if` / timeout / args / order),
  so the plugin's hook surface provably equals the dev repo's.
- `claude plugin marketplace add ./` registers `volundr` (Source: Directory) and it is
  discoverable; removed after the check.
- `git diff` shows `.claude/settings.json` unchanged → the dev-repo hook surface is untouched.
- The hook *scripts* the plugin points at are the **same files** the dev repo already runs via
  `settings.json` (proven-firing this very session), only re-rooted from `${CLAUDE_PROJECT_DIR}`
  to `${CLAUDE_PLUGIN_ROOT}`.

Deferred to a clean-environment install (cannot run in-repo without double-firing, and a nested
`claude -p` session is unsupported): the end-to-end "installed plugin → hooks fire at runtime"
observation. Low-risk given the above (same scripts, validated + CC-accepted manifest, documented
additive merge), and the dev-repo restart independently re-verifies the unchanged `settings.json`
path. Final acceptance, when wanted: in a *separate* throwaway project run
`claude plugin marketplace add <volundr-path> && claude plugin install volundr@volundr`, restart,
and confirm a `session_started` event / hook side-effect.

## Versioning

`plugin.json` `version` tracks the framework milestone (Volundr **v5.0** → `5.0.0`, per
`framework/system-instructions.md` and the CHANGELOG). The marketplace self-entry omits `version`
so it derives from `plugin.json` (single source of truth); the validator errors if the two ever
disagree.

## Brain bootstrap for plugin installs (FRW-BL-074 — resolved)

`claude plugin validate --strict` notes that the repo-root `CLAUDE.md` is *not* loaded as project
context for plugin installers — so a plugin user gets the `vldr-*` skills + hooks + packs, but not
the orchestration brain (`CLAUDE.md` → `framework/system-instructions.md`) automatically.
`CLAUDE.md` must stay at the repo root for the dev workflow, and a CC plugin cannot inject an
always-on project-context file.

**Resolved (FRW-BL-074) the idiomatic way the validator itself recommends — a skill.** The plugin
ships **`vldr-boot`** (`.claude/skills/vldr-boot/SKILL.md`; namespaced `volundr:vldr-boot` when
installed). It is model-invocable on "wake up" / "boot/start/resume Volundr" and user-invocable; it
reads `framework/system-instructions.md` as the operating manual and runs the boot sequence. This
matches the dev-repo UX, where the developer also types **"Wake up!"** to boot.

**Reliable path resolution (the load-bearing detail).** The skill references the manual as
`${CLAUDE_PLUGIN_ROOT}/framework/system-instructions.md`. Per `plugins-reference.md`: *"All
\[path variables] are substituted inline anywhere they appear in skill content, agent content, hook
commands, … "* — so when the skill loads from the installed plugin, Claude Code substitutes the
real cache path **into the skill body** before the model sees it. (The env var `$CLAUDE_PLUGIN_ROOT`
is *not* available to the model's Bash tool — only to hook/MCP subprocesses — so the skill does not
depend on Bash; it relies on the documented skill-content substitution, with a literal-`${...}`
detection + relative-path fallback for the checkout case, and a Glob last resort.) This was the
defect an adversarial review caught and is the fix that makes the boot work in a real install.

**Honest residual + the always-on option.** The brain is **invoke-triggered**, not always-on — a
plugin fundamentally cannot inject an always-on `CLAUDE.md`-equivalent. In practice the first action
in a Volundr session *is* the boot trigger ("wake up"), so parity on the *action* is achieved. If
always-on is later wanted, the documented mechanism is a **SessionStart hook returning
`hookSpecificOutput.additionalContext`** (the plugin's `session-start.js` already runs and
`${CLAUDE_PLUGIN_ROOT}` is available to it) injecting the manual path/pointer at session start —
deferred here to avoid changing the shared, brick-critical session hook for a marginal gain.
