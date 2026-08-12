---
name: vldr-economy
license: MIT
description: Toggle or check economy mode on the active Volundr project - downgrade agent models to reduce cost
user-invocable: true
disable-model-invocation: true
disallowed-tools: Write, Edit
---

# Volundr Economy Mode

> **Operator-invocable only, deliberately — do not remove `disable-model-invocation` (FRW-BL-112).**
> This skill declares `disallowed-tools: Write, Edit`, and the platform applies a tool denial to the
> **entire session, subagents included** — not merely to this skill's own execution. Its own words:
> *"Write is disabled for this session, in subagents as well as here."* A model-invocable skill
> carrying that denylist lets Volundr strip its own ability to implement, mid-card, with no warning.
>
> Typing `/vldr-economy` yourself still works and is the intended path — economy mode is an operator
> cost decision, not a self-service one. Be aware that **invoking it while a card is in flight
> disables `Write`/`Edit` until the next session**, for the lead and every agent it spawns. Volundr
> reads and sets economy mode through the `/api/economy` endpoints instead.

Economy mode reduces cost by downgrading spawned agents **one tier** (`opus` → `sonnet` → `haiku`, floored at `haiku`). When enabled:
- The `volundr` lead is **never downgraded** — it orchestrates the whole run, so full capability is worth the cost.
- Every other spawned role steps down one tier (e.g. a `sonnet` role → `haiku`).
- Roles already at the `haiku` floor (`fixer`, `content`) are unchanged.

Tiers are shown as **aliases** (`opus`/`sonnet`/`haiku`). Each alias resolves to a concrete model outside this doc: `opus` and `sonnet` are pinned in `.claude/settings.json` via `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` (see `framework/guardrails.md` ISC-3); `haiku` uses Claude Code's built-in default. Role→tier is the single source of truth in `framework/hierarchy-config.ts` `MODEL_TIERS`; this doc is derived from it, so it never needs a model-version edit.

## Current State

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=r.activeProject;if(p){console.log(p)}else{console.log('NO_ACTIVE_PROJECT')}" 2>/dev/null`

## Instructions

1. Read the project ID from the output above
2. If no active project, say "No active project — start a project first"
3. Check current economy mode: `curl -s http://localhost:3141/api/projects/{id}/economy`
4. Based on the user's intent:
   - If they want to **enable** economy mode: `curl -s -X POST http://localhost:3141/api/projects/{id}/economy -H "Content-Type: application/json" -d '{"enabled": true}'`
   - If they want to **disable** economy mode: `curl -s -X POST http://localhost:3141/api/projects/{id}/economy -H "Content-Type: application/json" -d '{"enabled": false}'`
   - If they just want to **toggle**: `curl -s -X POST http://localhost:3141/api/projects/{id}/economy -H "Content-Type: application/json" -d '{"toggle": true}'`
   - If they just want the **status**: report current state from the GET call above

5. Report the new state and explain what it means for model costs.

## Tier Downgrade Table (economy mode ON)

Tiers are derived from `MODEL_TIERS.roles` (single source of truth) with the one-tier-down economy
rule. Each alias resolves to a concrete model via the `settings.json` pins (`opus`/`sonnet`) or
Claude Code's built-in default (`haiku`) — see `guardrails.md` ISC-3.

| Agent type | Normal tier | Economy tier |
|---|---|---|
| volundr (lead) | `opus` | `opus` (never downgraded) |
| architect | `sonnet` | `haiku` |
| developer | `sonnet` | `haiku` |
| qa-engineer | `sonnet` | `haiku` |
| devops-engineer | `sonnet` | `haiku` |
| designer | `sonnet` | `haiku` |
| reviewer | `sonnet` | `haiku` |
| guardian | `sonnet` | `haiku` |
| researcher | `sonnet` | `haiku` |
| tester | `sonnet` | `haiku` |
| planner | `sonnet` | `haiku` |
| fixer | `haiku` | `haiku` (floor) |
| content | `haiku` | `haiku` (floor) |
