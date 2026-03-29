---
name: vldr-shutdown
description: Execute the Volundr graceful shutdown protocol. This runs BEFORE the session ends, while you still have full context.
user-invocable: true
disable-model-invocation: false
---

# Volundr Shutdown Protocol

Execute the graceful shutdown sequence. This skill runs while you still have full context — BEFORE the session ends.

**Trigger words:** "stop", "goodnight", "pause", "wrap up", "let's stop", "shut it down"

## Sequence

Execute these steps in order. Do not skip steps. If dashboard is down, fall back to file writes.

### Step 1: Announce
Say: "Starting shutdown protocol."

### Step 2: Update heartbeat
```bash
curl -s -X POST http://localhost:3141/api/events \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<PROJECT_ID>","type":"shutdown_started","detail":"Graceful shutdown initiated"}'
```

### Step 3: Commit WIP
Check for uncommitted changes on any card branches. For each:
```bash
git status --short
# If changes exist: git add <relevant files> && git commit -m "wip(card-XX-NNN): shutdown save"
```

### Step 4: Complete running agents
```bash
# Get running agents
curl -s "http://localhost:3141/api/projects/<PROJECT_ID>/agents?status=running"
# For each non-volundr agent, mark complete:
# curl -s -X PATCH http://localhost:3141/api/agents/<AGENT_ID> -H "Content-Type: application/json" -d '{"status":"completed"}'
```

### Step 5: Gather metrics
```bash
curl -s http://localhost:3141/api/projects/<PROJECT_ID>/metrics
curl -s http://localhost:3141/api/projects/<PROJECT_ID>/cards
```

### Step 6: Write session summary
POST to `/api/session-summaries` with:
- `projectId`, `startedAt`, `summary` (narrative paragraph)
- `keyDecisions` (JSON array), `blockers`, `nextSteps`
- `phaseAtStart`, `phaseAtEnd`, `cardsCompleted`, `cardsStarted`

### Step 7: Pending journal entries
Flush any decisions/insights not yet logged via `POST /api/journal`.

### Step 8: Self-review (most important)
Analyze this session:
- Quality trend: session avg vs all-time avg
- Retry/failure analysis: which cards, why
- Cost efficiency: cards/dollar, cache read ratio
- Pattern identification: what worked, what didn't
- Write lessons: `POST /api/lessons` (project and global)
- Update `constraints.md` if new antipatterns found

### Step 9: Checkpoint
Write checkpoint to `VLDR_HOME/projects/{id}/checkpoints/checkpoint-{N}.md`:
- Progress, quality, cost summary
- Active work and blockers
- Key decisions since last checkpoint
- Next steps

Tag git: `git tag checkpoint-{N} -m "summary"`

### Step 10: Complete Volundr agent
```bash
curl -s -X PATCH http://localhost:3141/api/agents/<VOLUNDR_AGENT_ID> \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'

curl -s -X POST http://localhost:3141/api/events \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<PROJECT_ID>","type":"session_ended","detail":"Graceful shutdown complete"}'
```

### Step 11: Final status
Present to the developer:
- What was accomplished this session
- Current WIP and blockers
- Recommended next steps
- "Session saved. Safe to close."

### Step 12: Stop responding
The developer closes the session.

## Error Handling
- Dashboard down: write session summary to `VLDR_HOME/projects/{id}/checkpoints/` as file
- Low context: skip Step 8 (self-review), do everything else
- The SessionEnd hook handles mechanical cleanup as a safety net
