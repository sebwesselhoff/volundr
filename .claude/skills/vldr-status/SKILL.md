---
name: vldr-status
license: MIT
description: Show current Volundr project status - active project, card progress, running agents, costs
user-invocable: true
disable-model-invocation: true
disallowed-tools: Write, Edit
---

# Volundr Project Status

> **Operator-invocable only, deliberately — do not remove `disable-model-invocation` (FRW-BL-112).**
> This skill declares `disallowed-tools: Write, Edit`, and the platform applies a tool denial to the
> **entire session, subagents included** — not merely to this skill's own execution. Its own words:
> *"Write is disabled for this session, in subagents as well as here."* This skill already carried
> `disable-model-invocation: true` before FRW-BL-112 and so was never a live hazard; the flag is now
> a lint-enforced invariant for every denylisted skill rather than a per-file accident.
>
> Typing `/vldr-status` yourself still works and is the intended path. Be aware that **invoking it
> while a card is in flight disables `Write`/`Edit` until the next session**, for the lead and every
> agent it spawns. Volundr derives the same status from the dashboard API instead.

Show the current Volundr project status.

## Project

!`curl -s http://localhost:3141/api/health 2>/dev/null || echo '{"status":"dashboard_offline"}'`

## Active Project

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=r.activeProject;if(p){const proj=r.projects[p];console.log('Project: '+proj.name+' ('+p+')\\nPath: '+proj.path)}else{console.log('No active project')}" 2>/dev/null || echo 'Registry not found'`

## Instructions

Based on the data above, present a concise status summary:
1. Dashboard health (online/offline)
2. Active project name and status
3. If a project is active, fetch and display:
  - Card progress: `curl -s http://localhost:3141/api/projects/{id}/cards` - count by status
  - Running agents: `curl -s http://localhost:3141/api/projects/{id}/agents?status=running` - list type and detail
  - Total cost: `curl -s http://localhost:3141/api/projects/{id}/metrics` - totalEstimatedCost

Format as a brief status dashboard. If dashboard is offline, say so and suggest starting it.
