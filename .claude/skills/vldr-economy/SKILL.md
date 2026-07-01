---
name: vldr-economy
description: Toggle or check economy mode on the active Volundr project - downgrade agent models to reduce cost
user-invocable: true
disable-model-invocation: false
disallowed-tools: Write, Edit
---

# Volundr Economy Mode

Economy mode reduces cost by downgrading non-critical agent models. When enabled:
- `volundr` stays on `claude-opus-4-8` (always full model)
- `architect` stays on `claude-sonnet-5`
- All other agents (developer, qa, reviewer, guardian, researcher, etc.) downgrade to `claude-haiku-4-5`

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

## Model Downgrade Table (economy mode ON)

| Agent type | Normal model | Economy model |
|---|---|---|
| volundr | claude-opus-4-8 | claude-opus-4-8 (unchanged) |
| architect | claude-opus-4-8 | claude-sonnet-5 |
| developer | claude-sonnet-5 | claude-haiku-4-5 |
| qa-engineer | claude-sonnet-5 | claude-haiku-4-5 |
| reviewer | claude-sonnet-5 | claude-haiku-4-5 |
| guardian | claude-sonnet-5 | claude-haiku-4-5 |
| researcher | claude-sonnet-5 | claude-haiku-4-5 |
| content | claude-sonnet-5 | claude-haiku-4-5 |
| fixer | claude-sonnet-5 | claude-haiku-4-5 |
| planner | claude-sonnet-5 | claude-haiku-4-5 |
