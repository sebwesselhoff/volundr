Execute the Vǫlundr graceful shutdown protocol. This runs BEFORE the session ends, while you still have full context and SDK access.

Read `framework/shutdown-protocol.md` for the full specification, then execute this sequence:

## Shutdown Sequence

### Phase 0: Acknowledge
- Tell the developer: "Starting shutdown protocol. This will take 30-60 seconds."
- Update heartbeat: `vldr.updateHeartbeat('shutting_down', null, 0)`
- Log event: `vldr.events.log({ type: 'shutdown_started', detail: 'Graceful shutdown initiated' })`

### Phase 1: Save in-progress work
- Query all cards: `vldr.cards.list()`
- For each `in_progress` card: if you were actively working, commit WIP to the card branch
- Complete all running agents EXCEPT the Vǫlundr agent
- Log: `vldr.events.log({ type: 'state_saved', detail: 'WIP saved at shutdown' })`

### Phase 2: Gather session metrics
- `vldr.metrics.get()` for quality, cost, throughput data
- `vldr.project.get()` for current phase
- `vldr.cards.list()` for card statuses
- `vldr.agents.list()` for agent data
- `vldr.events.list({ limit: 50 })` for recent events
- `vldr.quality.list()` for quality scores
- Determine session start time from the Vǫlundr agent's `startedAt` field

### Phase 3: Write session summary
- POST to `/api/session-summaries` with:
 - projectId, startedAt, narrative summary
 - keyDecisions (JSON array), blockers (JSON array), nextSteps (JSON array)
 - phaseAtStart, phaseAtEnd
 - cardsCompleted (JSON array of IDs), cardsStarted (JSON array of IDs)

### Phase 4: Write journal entries
- Flush any pending observations not yet journaled
- POST to `/api/journal` with entryType: milestone, insight, blocker, or decision

### Phase 5: Self-learning feedback loop (MOST IMPORTANT PHASE)
Review your own performance this session:
- **Quality:** Session avg vs all-time avg. Which cards scored low? Which scored high? Why?
- **Retries:** How many cards needed retries? What caused them?
- **Cost:** Cards per dollar. Cache read ratio. Right-sized models?
- **Patterns:** What prompt templates or agent configs worked best?
- **Antipatterns:** What led to failures? New patterns for constraints.md?
- Write project lessons: `vldr.lessons.create({ ..., isGlobal: false })`
- Write global lessons: `vldr.lessons.create({ ..., isGlobal: true })`
- Update `VLDR_HOME/projects/{id}/constraints.md` if new antipatterns found

### Phase 6: Write checkpoint
- Write to `VLDR_HOME/projects/{id}/checkpoints/checkpoint-{N}.md`
 - Progress, quality, cost, active work, blockers, next steps, self-review summary
- Git tag: `git tag checkpoint-{N} -m "Session shutdown"`
- Log: `vldr.events.log({ type: 'checkpoint_created', detail: 'Shutdown checkpoint' })`

### Phase 7: Complete Vǫlundr agent
- `vldr.agents.update(volundrAgentId, { status: 'completed', completedAt: now })`
- `vldr.events.log({ type: 'session_ended', detail: 'Graceful shutdown complete' })`
- Do NOT clear activeProject - the SessionEnd hook handles that

### Phase 8: Present final status
Show the developer:
- What was accomplished (cards completed, phase transitions)
- What's still in progress (WIP branches)
- Blockers for next session
- Prioritized next steps
- Quality and cost summary
- "You can close this session now."

## Error handling
- If dashboard is unreachable: write summaries and checkpoint to files instead
- If context is low: skip Phase 5, write minimal checkpoint
- Wrap every API call in try/catch - never let a failed API call abort the protocol
