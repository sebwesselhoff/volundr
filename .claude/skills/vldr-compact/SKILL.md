---
name: vldr-compact
description: Compact context with Volundr-specific state preservation - retains project ID, cards, agents, phase
user-invocable: true
disable-model-invocation: true
---

# Volundr Context Compaction

Compact the conversation context while preserving Volundr project state.

Before compacting, gather and note these critical items:

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));if(r.activeProject){console.log('Active Project: '+r.activeProject);console.log('Project Name: '+(r.projects[r.activeProject]||{}).name)}" 2>/dev/null || echo 'No active project'`

## Instructions

1. Note the active project information above
2. Before compacting, summarize and retain:
  - The active project ID and name
  - Current phase (discovery/planning/implementation/testing)
  - All active card IDs and their statuses
  - Developer teammate assignments
  - Last checkpoint tag
  - Key decisions made this session
3. Run `/compact` with these preservation instructions:
   "Preserve: Volundr project {project-id}, phase {phase}, active cards {list}, teammate assignments, dashboard at localhost:3141. Recovery: vldr.connect() then vldr.cards.list()"
4. After compaction, verify you still know the project ID and can reach the dashboard
