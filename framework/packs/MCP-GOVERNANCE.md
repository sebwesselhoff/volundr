# Pack MCP Governance (FRW-BL-035)

Volundr packs ship a **machine-readable** `framework/packs/<pack>/.mcp.json` so teammates
and subagents load only **vetted** MCP servers — replacing the old prose-only mentions in
teammate prompts. This document is the managed baseline: the templating convention, the
allow/deny stance, `strict-mcp-config` compatibility, and `alwaysLoad` semantics.

Validator: `scripts/validate-pack-mcp.mjs` (run `node scripts/validate-pack-mcp.mjs`).
CC floors (`framework/cc-version-baseline.md`): `alwaysLoad` MCP — 2.1.121 ·
`--strict-mcp-config` for subagents — 2.1.150.

---

## 1. `${VAR}` templating convention

Every `.mcp.json` is a **template**. It MUST NOT contain real secrets, absolute machine
paths, or tenant identifiers as literals. Two placeholder forms are allowed:

| Placeholder | Meaning | Example use |
|-------------|---------|-------------|
| `${CLAUDE_PROJECT_DIR}` | Project root, injected by Claude Code at load time | `"args": ["${CLAUDE_PROJECT_DIR}/server.js"]`, `"CO_TESTING_REPO_ROOT": "${CLAUDE_PROJECT_DIR}"` |
| `${ENV_VAR}` | Any environment variable, expanded from the launching shell | `"ATLASSIAN_API_TOKEN": "${ATLASSIAN_API_TOKEN}"` |

Rules:

- **Secrets are ALWAYS `${ENV_VAR}`** — tokens, keys, passwords, connection strings,
  subscription/tenant IDs. Never a literal. The validator rejects secret-looking literals.
- **Project-relative paths use `${CLAUDE_PROJECT_DIR}`** — never a hard-coded absolute path
  (no `C:\Users\...`, no `/home/...`), so the template is portable across machines and the
  per-project worktrees Volundr spawns.
- Placeholders must be **well-formed**: `${NAME}` with `NAME` matching `[A-Z0-9_]+`
  (`CLAUDE_PROJECT_DIR` or `SCREAMING_SNAKE`). A bare `$FOO`, an unterminated `${FOO`, or a
  lowercase `${foo}` is rejected.

**Hot-reload note.** Claude Code re-reads `.mcp.json` when the file changes within a session
(and on the next session start). Editing a pack's `.mcp.json` does **not** require recreating
a teammate — the server set is picked up on reload. `${VAR}` values are resolved **at load
time** from the then-current environment, so an env var exported after launch is only seen on
the next (re)load. Keep edits additive and valid: a malformed `.mcp.json` is skipped on
reload, silently dropping its servers.

---

## 2. Managed allow/deny baseline

**Deny by default.** A pack may load **only** the servers listed for it below (its
allowlist). Any server not on a pack's allowlist is denied — do not add a server to a
`.mcp.json` without adding it here first. New servers must be vetted (trusted publisher,
known endpoint, least-privilege scopes) before being added to a pack.

| Pack | Allowed MCP servers | `alwaysLoad` (essential) | On-demand |
|------|---------------------|--------------------------|-----------|
| `research` | `playwright`, `atlassian`, `microsoft-learn` | `playwright` | `atlassian`, `microsoft-learn` |
| `testing` | `playwright`, `co-testing` | `playwright` | `co-testing` |
| `infrastructure` | `azure`, `playwright` | `azure` | `playwright` |
| `frontend` | `playwright` | `playwright` | — |
| `azure` | `azure`, `microsoft-learn` | `azure` | `microsoft-learn` |

Packs **not** listed (`core`, `quality`, `security`, `languages`, `roundtable`) intentionally
ship **no** `.mcp.json` — their personas need no MCP servers, and an absent file means "no MCP
servers for this pack" (the strictest stance). Do not add an empty `.mcp.json`.

**Vetting checklist for a new entry**

1. Trusted publisher / first-party package or a known, owned endpoint URL.
2. Read-mostly by default; any write capability is documented and least-privilege.
3. Secrets via `${ENV_VAR}` only; no literal credentials.
4. Added to the pack's `.mcp.json` **and** to the table above in the same change.

---

## 3. strict-mcp-config compatibility

Isolated teammates and subagents launch with `claude --strict-mcp-config --mcp-config <file>`.
Under `--strict-mcp-config`, Claude Code loads **only** the named config file(s) and **ignores
all other MCP config** — user-scope, project-scope `.mcp.json` at the repo root, and
enterprise config are NOT merged. This is the isolation guarantee: a teammate sees exactly the
servers its pack vetted, nothing inherited from the host environment.

For this to hold, each pack `.mcp.json` MUST be **self-contained**:

- No external includes / `$ref` / `extends` / `import` pointing at another config file. The
  only allowed top-level keys beyond `mcpServers` are documentation-only (`$schema`). The
  validator rejects external-reference keys.
- All inputs are supplied via `${CLAUDE_PROJECT_DIR}` / `${ENV_VAR}` resolved at load time —
  not by composing with another config file.
- One file fully describes the pack's server set, so it can be passed directly:
  `claude --strict-mcp-config --mcp-config framework/packs/<pack>/.mcp.json`.

Because the file is self-contained, Volundr can pass a pack's `.mcp.json` (or a merged subset
of several packs' files) to a teammate/subagent and be certain no un-vetted server leaks in.

---

## 4. `alwaysLoad` semantics

Claude Code defers MCP tool exposure behind **tool-search** by default: a server's tools are
discovered lazily when the model searches for them, which keeps the system prompt small but
adds a hop before first use. `alwaysLoad: true` opts a server **out** of that deferral — its
tools are loaded up front and are immediately available.

Volundr convention:

- Mark `alwaysLoad: true` on the **one** server a pack's primary persona reaches for on nearly
  every card (Playwright for `frontend`/`testing`/`research`, Azure for
  `infrastructure`/`azure`). These skip tool-search deferral.
- **Omit** `alwaysLoad` (defaults to deferred) on situational servers — `atlassian`,
  `microsoft-learn`, `co-testing`, smoke-test `playwright` — so they cost nothing until needed.
- Keep `alwaysLoad` servers to a minimum (ideally one per pack): every always-loaded server
  enlarges every prompt for that teammate.

`alwaysLoad` is a Volundr pack annotation carried on the server entry; the validator reports
which servers in each file are `alwaysLoad` so the essential set stays auditable.
