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

Both `post-bash-git.js` (PostToolUse:Bash) and `tool-failure.js` (PostToolUseFailure) emit a `tool_telemetry` dashboard event after each tool invocation:

```json
{
  "type": "tool_telemetry",
  "detail": "Bash 1234ms effort=high",
  "tool_name": "Bash",
  "duration_ms": 1234,
  "effort_level": "high",
  "session_id": "..."
}
```

### Fields

| Field | Source | Notes |
|-------|--------|-------|
| `tool_name` | `input.tool_name` or `"Bash"` for PostToolUse:Bash | |
| `duration_ms` | `input.duration_ms` (defensive: `Number.isFinite` check) | **DOC-SILENT** — see caveat below |
| `effort_level` | `input.effort?.level` | validated against enum |
| `session_id` | `input.session_id` | omitted when absent |

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
