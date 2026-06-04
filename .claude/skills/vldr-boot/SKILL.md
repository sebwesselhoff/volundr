---
name: vldr-boot
description: Boot the Volundr orchestration framework - locate and load the operating manual (framework/system-instructions.md) and run its boot sequence. Use on "wake up", "boot/start/resume Volundr", or when starting work on a Volundr project (especially when installed as a plugin, where there is no project CLAUDE.md to load the brain).
user-invocable: true
disable-model-invocation: false
---

# Volundr Boot

This skill loads the **Volundr operating brain** and starts a session. It exists so Volundr works
when **installed as a plugin** (where the dev-repo `CLAUDE.md` that normally points to the operating
manual is not loaded as project context). It is also a convenient boot in a Volundr checkout.
Invoke it with `/volundr:vldr-boot` (installed plugin) or `/vldr-boot` (checkout), or just say
"wake up". Do exactly the following, in order.

## 1. Locate and read the operating manual

Your operating manual is `framework/system-instructions.md`. **Read it IN FULL** with the Read
tool — resolve its path by the first option that works:

1. **Installed-plugin context — `${CLAUDE_PLUGIN_ROOT}/framework/system-instructions.md`.**
   When this skill is loaded from the installed Volundr plugin, Claude Code substitutes
   `${CLAUDE_PLUGIN_ROOT}` **inline in this skill's content** with the plugin's real (cache)
   install path — so the path above is already absolute. Just Read it.
   *(Do not rely on `$CLAUDE_PLUGIN_ROOT` being set in your Bash environment — it is exported only
   to hook/MCP subprocesses, not to your Bash tool. The substitution above happens in this text.)*
2. **Dev-repo / checkout context.** If the line above still shows a **literal** `${CLAUDE_PLUGIN_ROOT}`
   (the variable was NOT substituted → you are in a Volundr checkout, not a plugin install), read
   `framework/system-instructions.md` relative to the current project root instead.
3. **Fallback.** If neither resolves, find it with the **Glob** tool
   (`**/framework/system-instructions.md`), preferring a match whose sibling tree also contains
   `framework/agents/registry.ts`.

Treat the file's contents as your authoritative operating manual (your identity is **Volundr**).
Also read a project `CLAUDE.md` if one exists in the working directory — project-specific
instructions take precedence over framework defaults.

## 2. Run the Boot Sequence

Execute the **Boot Sequence** exactly as the manual specifies: resolve `VLDR_HOME`; health-check
the dashboard at `http://localhost:3141/api/health` and start it if needed; read
`VLDR_HOME/projects/registry.json`; present the project menu / select the active project; register
the Volundr lead agent (with `sessionId`); load HOT/WARM context (last session summary, journal,
constraints, lessons); set the heartbeat ready. Then resume from card statuses or begin the
Discovery Interview, as the manual directs.

> If the dashboard is unreachable after retries, warn the developer and fall back to flat-file mode
> per the manual — do not abort the boot.
