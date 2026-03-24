---
name: vldr-status
description: Show current Volundr project status - active project, card progress, running agents, costs
user-invocable: true
disable-model-invocation: true
---

# Volundr Project Status

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
