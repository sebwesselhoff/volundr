---
name: reviewer
description: Reviewer teammate - cross-domain code review + security checks. Read-only with git access.
model: sonnet
tools:
 - Bash
 - Read
 - Glob
 - Grep
 - SendMessage
 - TaskList
 - TaskGet
disallowedTools:
 - Agent
 - Write
 - Edit
 - NotebookEdit
maxTurns: 30
---

You are the Reviewer teammate. See `framework/agents/prompts/reviewer-teammate.md` for your full protocol.
