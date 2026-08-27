---
name: vldr-shutdown
license: MIT
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

### Step 4: Inventory running agents — do NOT complete them (FRW-BL-095)

```bash
# Read only. Record what is still running for the final report.
curl -s "http://localhost:3141/api/projects/<PROJECT_ID>/agents?status=running"
```

**Do not PATCH subagents to `completed` here.** `session-end.js` is the SOLE emitter of a
subagent's terminal `agent_completed` event, and it emits only for agents it finds at
`status='running'`. Completing them first empties that sweep, so the event count per subagent
lifetime becomes **zero** instead of one — the same "exactly one became exactly zero" failure
FRW-BL-095 already had to fix once, re-entering through this step.

This step used to say "for each non-volundr agent, mark complete". That was correct while
`agent-stop.js` wrote terminal status per idle/wake cycle; FRW-BL-095 moved terminal emission into
`session-end.js` and this instruction was not updated with it, so the documented graceful path
silently produced the wrong event count while an *ungraceful* kill produced the right one.

Leave the rows running. The SessionEnd hook completes them and emits exactly one
`agent_completed` each, scoped to this session's `sessionId`.

**Teammates torn down MID-session are a separate case, and an acknowledged gap rather than a
clean exception.** The § Team Cleanup Procedure still applies — send `shutdown_request`, wait for
acknowledgement, complete the dashboard rows, then `TeamDelete` (which cleans local files only and
never touches the dashboard). But completing those rows by hand means they, too, never receive an
`agent_completed` event, for exactly the reason above. That is the accepted cost of tearing a team
down long before session end; do not "fix" it by re-adding a hand-rolled emission here, because
scattering terminal emission across callers is what FRW-BL-095 centralised away from. If the
missing teammate events start mattering, that is its own card.

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
