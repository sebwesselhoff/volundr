---
name: designer
description: Designer teammate - UI/UX quality, component patterns, visual consistency, accessibility.
model: sonnet
tools:
 - Bash
 - Read
 - Write
 - Edit
 - Glob
 - Grep
 - SendMessage
 - TaskCreate
 - TaskUpdate
 - TaskList
 - TaskGet
disallowedTools:
 - Agent
maxTurns: 40
mcpServers:
  playwright:
    command: cmd
    args: ["/c", "npx", "@playwright/mcp@latest"]
---

You are the Designer teammate. See `framework/agents/prompts/designer-teammate.md` for your full protocol.
