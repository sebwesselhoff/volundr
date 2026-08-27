# Volundr Telemetry Guide

## Overview

Volundr uses two complementary observability paths:

1. **Dashboard token-derived cost model** (PRIMARY) — the Forge dashboard tracks per-project token spend, tool events, and per-card effort via its own SQLite store. This is always on and requires no extra configuration.
2. **Opt-in OTel exporter** (SECONDARY) — Claude Code can emit OpenTelemetry spans and logs if the environment variables below are set. Off by default.

---

## Primary Path: Dashboard Events

Every hook posts structured events to `POST /api/events`. Cost and effort are derived from dashboard tokens and `tool_telemetry` events (see below), not from OTel.

The `/usage` endpoint (Claude Code `--usage` or the in-app `/usage` slash command) provides a per-category breakdown as a manual cross-check:

- Skills activated
- Subagent invocations
- Plugin calls
- Per-MCP-server cost
- Large session files (memory warnings)

Use `/usage` snapshots to validate that dashboard aggregates match observed spend.

---

## Per-Tool Telemetry (FRW-BL-038)

`post-bash-git.js` and `tool-failure.js` emit a `tool_telemetry` dashboard event.

**Coverage is SCOPED, and this line used to imply it was not (FRW-BL-119).** `post-bash-git.js` is
registered `PostToolUse` with matcher `Bash|PowerShell|Monitor` — `Read`, `Grep`, `Glob`, `Edit` and
every other tool never trigger it on success. `tool-failure.js` uses matcher `""` (all tools) but
fires only on `PostToolUseFailure`. So **a read-only agent emits zero `tool_telemetry` for an entire
successful run**, and since the computed liveness signal is fed by these events, such an agent reads
`idle` and then `stalled` while provably working. Measured 2026-08-27: a read-heavy auditor flipped
to `idle` within 75 seconds of spawning while a shell-heavy subagent held `working`. Tracked as
FRW-BL-119.

```json
{
  "projectId": "volundr-meta",
  "type": "tool_telemetry",
  "detail": "Bash 1234ms effort=high",
  "agentId": "8286103e-4120-4c92-a2c4-13c0144e0c8a"
}
```

That is the whole payload. **`tool_name`, `duration_ms`, `effort_level` and `session_id` are NOT
sent** (FRW-BL-116 ISC-5). They are computed locally, folded into `detail`, and then deliberately
dropped: `POST /api/events` destructures exactly
`{ projectId, cardId, agentId, type, detail, costEstimate }` and the events table has no columns for
the rest, so sending them meant they were silently discarded server-side. An earlier version of this
document listed all four in a fields table with sourcing and validation notes, which read as
convincing evidence that structured telemetry existed when only the `detail` string survived.

### Fields

| Field | Source | Notes |
|-------|--------|-------|
| `detail` | composed locally | `"<tool> <duration>ms effort=<level>"` — the ONLY place tool, duration and effort survive. Parse this, not a column. |
| `agentId` | `.claude/hooks/vldr-agent-resolve.js` | Resolved `agent_id` **first**, then `session_id`. Omitted when unresolvable, which posts exactly as before. |

**The resolution order is load-bearing.** A subagent's hook payload carries the **parent's**
`session_id` — captured and enumerated on 2026-08-27, where three distinct subagents all reported the
lead's session id. Resolving by session first would attribute every subagent's tool calls to the
lead: the lead's liveness would look fixed for the wrong reason while every subagent stayed broken.
`agent_id` is present only for subagents, and its absence is what identifies the lead.

If structured columns are ever wanted, add the migration and re-add these fields **in the same
change** — never one without the other.

### effort.level

Read from `input.effort?.level` (stdin — canonical source). Valid values: `low`, `medium`, `high`, `xhigh`, `max`. Any other value is normalised to `'unknown'`.

Note: the effort ENV-var name that Claude Code might expose at the process level is uncertain. Prefer the stdin field `input.effort?.level`.

### duration_ms — doc-silent but CONFIRMED live

`duration_ms` is **doc-silent**: it is not listed in the official PostToolUse/PostToolUseFailure stdin schema. However, it is **confirmed populated at runtime** — on CLI 2.1.161 real `git`/bash commands produced dashboard events like `tool_telemetry :: Bash 2451ms effort=xhigh`, i.e. Claude Code DOES put a real `duration_ms` (and `effort.level`) into PostToolUse stdin.

The hooks still read it defensively (so they stay correct if a future CC build omits the field):

```js
const d = Number(input.duration_ms);
const durOk = input.duration_ms != null && Number.isFinite(d); // null/undefined → omit (avoid Number(null)===0)
// Only include duration when finite; omit the 'Xms' segment otherwise
```

---

## Opt-In OTel Exporter (OFF by default)

Claude Code ships an OpenTelemetry exporter that is disabled unless you set:

```sh
CLAUDE_CODE_ENABLE_TELEMETRY=1        # master switch — OFF by default
OTEL_METRICS_EXPORTER=otlp            # or 'prometheus', 'console'
OTEL_LOGS_EXPORTER=otlp               # or 'console'
OTEL_EXPORTER_OTLP_ENDPOINT=http://...
OTEL_EXPORTER_OTLP_PROTOCOL=grpc      # or 'http/protobuf'
```

Do NOT set `CLAUDE_CODE_ENABLE_TELEMETRY` in `.claude/settings.json` — the framework lead owns settings; OTel stays OFF by default.

### OTEL_LOG_TOOL_DETAILS (security-sensitive)

```sh
OTEL_LOG_TOOL_DETAILS=1   # opt-in; may include tool input parameters
```

**Security caveat**: enabling this flag causes tool input parameters (file contents, command arguments, etc.) to be included in OTel log events. Do not enable in shared or production environments without reviewing what is exported.

### Emitted Signals

| Signal | Name | Notes |
|--------|------|-------|
| Span | `claude_code.tool` | Per-tool invocation span; includes `agent_id` / `parent_agent_id` since CC 2.1.145 |
| Log event | `tool_decision` | Emitted when Claude decides to call a tool |
| Event | `claude_code.skill_activated` | Fired when a skill pack activates a registered skill |

---

## Manual Cross-Check Workflow

1. Run a session and let some cards complete.
2. Check `/usage` in the Claude Code interface for per-category totals.
3. Compare against the Forge dashboard token aggregate for the same project.
4. Any large discrepancy points to missing telemetry or an uncounted subagent session.
