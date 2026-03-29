# Graceful Shutdown Protocol - Volundr v6

## Overview

The shutdown protocol is a structured pre-exit ritual that Volundr executes while she still has full context, SDK access, and reasoning capacity. It runs BEFORE the SessionEnd hook (which has only 5 seconds and no LLM context). The protocol captures session work, performs self-assessment, writes persistence artifacts, and hands off cleanly to the hook-based cleanup.

**Design principle:** The SessionEnd hook handles mechanical cleanup (complete agents, clear registry). The shutdown protocol handles cognitive work (summarize, reflect, learn, checkpoint). They are complementary, not competing.

---

## 1. Trigger Mechanism

### Three trigger paths (all converge to the same sequence)

| Trigger | How it works | Reliability |
|---------|-------------|-------------|
| **`/vldr-shutdown` slash command** | User explicitly types `/vldr-shutdown`. Claude Code loads the command file from `.claude/commands/vldr-shutdown.md`, which instructs Volundr to execute the shutdown sequence. | Highest - explicit intent |
| **Natural language detection** | User says "let's stop", "goodnight", "pause the project", "I'm done for today", "shut it down", "wrap up". Volundr recognizes intent and initiates the protocol. | High - Volundr is already instructed to handle "Pause" in the intervention protocol |
| **End-of-work detection** | All cards for the current round are done, no more unblocked work exists, and Volundr would normally report "nothing left to do." Volundr proactively offers: "All current work is complete. Shall I run the shutdown protocol?" | Medium - requires Volundr to check |

### Why NOT a hook?

Hooks run in child Node.js processes with no LLM context, no SDK client, and strict timeouts (5-15 seconds). The shutdown protocol requires:
- Reading metrics from the dashboard API and reasoning about them
- Writing narrative summaries (LLM generation)
- Making judgment calls about lesson promotion
- Presenting a status report to the developer

None of this is possible in a hook. The shutdown protocol MUST run as Volundr's final act within the conversation, using her full tool access.

### Why NOT modify SessionEnd?

The `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` is set to 5000ms. Even if raised, the SessionEnd hook is a Node.js script with no LLM context. It cannot write summaries or reason about quality. It should remain a safety net for mechanical cleanup.

---

## 2. The Shutdown Sequence

### Phase 0: Acknowledge intent (< 1 second)

```
Volundr: "Starting shutdown protocol. This will take 30-60 seconds."
```

Update heartbeat to signal shutdown is in progress:
```typescript
vldr.updateHeartbeat('shutting_down', null, 0);
```

Log the event:
```typescript
vldr.events.log({ type: 'checkpoint_created', detail: 'Shutdown protocol initiated' });
```

### Phase 1: Save in-progress work (5-10 seconds)

1. **Query card state:**
   ```typescript
   const cards = await vldr.cards.list();
   const inProgress = cards.filter(c => c.status === 'in_progress');
   ```

2. **For each in-progress card:**
  - If Volundr was actively implementing: commit current work on the card branch
     ```bash
     git add <files-for-card>
     git commit -m "wip(card-{ID}): shutdown save - incomplete"
     ```
  - Update card status if appropriate (leave as `in_progress` - do NOT mark done)
  - Log: `vldr.events.log({ type: 'state_saved', cardId, detail: 'WIP committed at shutdown' })`

3. **Complete running teammates/subagents** (if any are still active):
   ```typescript
   const running = await vldr.agents.list({ status: 'running' });
   // Filter out the mother agent - she completes last
   const nonVolundr = running.filter(a => a.type !== 'mother');
   for (const agent of nonVolundr) {
     await vldr.agents.update(agent.id, {
       status: 'completed',
       completedAt: new Date().toISOString(),
     });
   }
   ```

### Phase 2: Gather session metrics (3-5 seconds)

Collect data for the summary and self-review:

```typescript
const metrics = await vldr.metrics.get();
const project = await vldr.project.get();
const allCards = await vldr.cards.list();
const allAgents = await vldr.agents.list();
const recentEvents = await vldr.events.list({ limit: 50 });
const qualityScores = await vldr.quality.list();
const projectLessons = await vldr.lessons.list();
```

Derive session-scoped data:
- **Cards completed this session:** Compare `completedAt` timestamps against session start time
- **Cards started this session:** Cards moved from `backlog` to any other status
- **Agents spawned this session:** Filter by `startedAt` >= session start
- **Quality scores this session:** Filter qualityTrend by timestamp
- **Total cost this session:** Sum `estimatedCost` for session agents
- **Tool failures this session:** Filter events by type `error` and session timestamp

### Phase 3: Write session summary (5-10 seconds)

Write to the Dashboard DB via the session-summaries API:

```typescript
await fetch(`${API_URL}/api/session-summaries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: PROJECT_ID,
    startedAt: sessionStartTime,
    summary: narrativeSummary,          // Volundr generates this
    keyDecisions: JSON.stringify([...]), // Decisions made this session
    blockers: JSON.stringify([...]),     // Unresolved blockers
    nextSteps: JSON.stringify([...]),    // What to do next session
    phaseAtStart: phaseWhenSessionBegan,
    phaseAtEnd: project.phase,
    cardsCompleted: JSON.stringify(completedCardIds),
    cardsStarted: JSON.stringify(startedCardIds),
  }),
});
```

The narrative summary should cover:
- What was accomplished (cards completed, features built)
- Key architecture decisions made
- Problems encountered and how they were resolved
- Developer interactions and feedback
- Phase transitions (e.g., "moved from blueprint to implementation")

### Phase 4: Write journal entries (3-5 seconds)

Flush any pending observations that weren't journaled during the session:

```typescript
// Final journal entry for the session
await fetch(`${API_URL}/api/journal`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: PROJECT_ID,
    entry: 'Session shutdown: [observation text]',
    entryType: 'milestone',
    sessionTag: sessionTag,
  }),
});
```

Entry types to write at shutdown:
- `milestone` - if a domain or phase completed
- `insight` - any unlogged observations about the codebase
- `blocker` - if work is blocked and needs human input next session
- `decision` - any architectural decision that wasn't journaled during implementation

### Phase 5: Self-learning feedback loop (10-20 seconds)

This is the core cognitive work of the shutdown protocol. Volundr reviews her own performance.

#### 5a. Quality trend analysis

```typescript
const sessionScores = qualityTrend.filter(q =>
  new Date(q.timestamp) >= new Date(sessionStartTime)
);
const sessionAvg = sessionScores.length > 0
  ? sessionScores.reduce((sum, s) => sum + s.score, 0) / sessionScores.length
  : null;
const allTimeAvg = metrics.averageQualityScore;
```

Questions Volundr asks herself:
- Is `sessionAvg` higher or lower than `allTimeAvg`? By how much?
- Which cards scored lowest? What went wrong?
- Which cards scored highest? What pattern made them succeed?
- Are there specific dimensions (completeness, code quality, format, independence) trending down?

#### 5b. Retry and failure analysis

```typescript
const sessionRetries = recentEvents.filter(e =>
  e.type === 'retry_triggered' &&
  new Date(e.timestamp) >= new Date(sessionStartTime)
);
const sessionErrors = recentEvents.filter(e =>
  e.type === 'error' &&
  new Date(e.timestamp) >= new Date(sessionStartTime)
);
const buildGateFailures = recentEvents.filter(e =>
  e.type === 'build_gate_failed' &&
  new Date(e.timestamp) >= new Date(sessionStartTime)
);
```

Questions:
- Which cards needed retries? Why?
- Were build gate failures from type errors, missing imports, or logic bugs?
- Did tool failures cluster around a specific tool or pattern?
- Were there timeout issues with agents?

#### 5c. Cost efficiency analysis

```typescript
const sessionAgents = allAgents.filter(a =>
  new Date(a.startedAt) >= new Date(sessionStartTime)
);
const sessionCost = sessionAgents.reduce((sum, a) => sum + a.estimatedCost, 0);
const cardsPerDollar = completedCardIds.length / Math.max(sessionCost, 0.01);
const tokenEfficiency = sessionAgents.reduce((sum, a) =>
  sum + a.cacheReadTokens, 0) / Math.max(
    sessionAgents.reduce((sum, a) => sum + a.promptTokens + a.cacheCreationTokens + a.cacheReadTokens, 0),
    1
  );
```

Questions:
- How many cards per dollar? Is this improving over sessions?
- What percentage of tokens were cache reads vs. fresh input? (Higher cache = more efficient)
- Were agents sized correctly? (Did XL tasks actually need XL agents?)
- Were any agents spawned unnecessarily?

#### 5d. Pattern identification

Volundr looks for patterns across all the data:
- **Winning patterns:** What prompt templates, agent configurations, or card structures led to 9.0+ scores?
- **Antipatterns:** What configurations led to retries or sub-6.0 scores?
- **Process improvements:** Did the hierarchy level work well? Should it change?
- **Teammate communication:** Were inter-agent messages effective or noisy?

#### 5e. Write lessons

For each identified insight, create a lesson:

```typescript
// Project-level lesson (specific to this codebase)
await vldr.lessons.create({
  title: 'Pattern: [description]',
  content: '[What happened, why it matters, how to apply next time]',
  stack: project.stack || 'general',
  source: `${PROJECT_ID} (session ${sessionDate})`,
  isGlobal: false,
});

// Global lesson (broadly applicable across projects)
await vldr.lessons.create({
  title: 'Lesson: [description]',
  content: '[What happened, why it matters, how to apply in any project]',
  stack: 'general',
  source: `${PROJECT_ID} (session ${sessionDate})`,
  isGlobal: true,
});
```

**Lesson promotion criteria:**
- Quality score improved because of a specific prompt change? -> Global lesson
- Build gate caught a recurring error type? -> Project-level antipattern, add to constraints.md
- Agent configuration worked well for a specific card size? -> Global lesson
- A codebase-specific workaround was needed? -> Project lesson only

#### 5f. Update constraints.md (if new antipatterns found)

If the self-review identified new antipatterns:

```markdown
## Discovered Antipatterns (Updated {date})

| Pattern | Why bad | Auto-check |
|---------|---------|------------|
| {new pattern} | {why} | grep -r '{pattern}' src/ |
```

### Phase 6: Write checkpoint file (3-5 seconds)

Write a rich checkpoint to `VLDR_HOME/projects/{id}/checkpoints/checkpoint-{N}.md`:

```markdown
# Checkpoint {N} - Session Shutdown ({date})

## Progress
- Phase: {phase}
- Cards: {done}/{total} done ({pct}%)
- Quality: {sessionAvg} avg this session, {allTimeAvg} all-time
- Cost: ${sessionCost} this session, ${totalCost} total

## Active Work
- In-progress cards: {list with WIP branches}
- Blocked cards: {list with blockers}
- Next unblocked cards: {list}

## Key Decisions This Session
{from session summary}

## Blockers
{unresolved issues needing human input}

## Next Steps
{prioritized list of what to do next session}

## Self-Review
- Quality trend: {improving/stable/declining}
- Cost efficiency: {cards/dollar}
- Retries: {count} ({rate}%)
- Lessons created: {count} ({global_count} global)
- Top insight: {most important takeaway}

## Recovery
If context is lost, run:
vldr.connect() -> vldr.project.get() -> vldr.cards.list()
Read this checkpoint for session context.
```

Git tag:
```bash
git tag checkpoint-{N} -m "Session shutdown - {done}/{total} cards"
```

Log event:
```typescript
vldr.events.log({ type: 'checkpoint_created', detail: `Shutdown checkpoint-${N}` });
```

### Phase 7: Complete Volundr agent and clear state (2-3 seconds)

```typescript
// Complete the Volundr agent
const volundrAgent = allAgents.find(a => a.type === 'mother' && a.status === 'running');
if (volundrAgent) {
  await vldr.agents.update(volundrAgent.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}

// Log final event
await vldr.events.log({ type: 'session_ended', detail: 'Graceful shutdown complete' });
```

**Important:** Do NOT clear `activeProject` from `registry.json` here. The SessionEnd hook handles that as a safety net. If we clear it here AND the hook fires, the hook would try to read an already-null activeProject (harmless but redundant). Letting the hook own this avoids duplication.

### Phase 8: Present final status to developer (immediate)

Volundr presents a concise report:

```
--- Session Complete ---

Accomplished:
- Completed {N} cards: {list}
- Phase: {start} -> {end}
- Quality: {avg} avg ({trend})
- Cost: ${amount}

Still in progress:
- {list of WIP cards with branches}

Blockers for next session:
- {list}

Next steps:
1. {top priority}
2. {second priority}
3. {third priority}

Checkpoint saved: checkpoint-{N}
Session summary saved to dashboard.

You can close this session now. Goodnight!
```

### Phase 9: Exit (immediate)

Volundr stops responding. The developer closes the terminal or types `/exit`.
When the session actually ends, the SessionEnd hook fires and performs mechanical cleanup:
- Completes any agents that Volundr did not (safety net)
- Clears activeProject in registry.json
- Logs session_ended event (if not already logged)

---

## 3. The `/vldr-shutdown` Command Definition

Create `.claude/commands/vldr-shutdown.md`:

```markdown
Execute the Volundr graceful shutdown protocol.

Steps:
1. Commit any in-progress work on card branches (WIP commits)
2. Complete all running agents except Volundr
3. Gather session metrics from the dashboard API (vldr.metrics.get())
4. Write a session summary to the dashboard (POST /api/session-summaries)
5. Write any pending journal entries (POST /api/journal)
6. Self-review: analyze quality trends, retries, cost efficiency, and patterns
7. Create lessons from insights (vldr.lessons.create - project and global)
8. Update constraints.md if new antipatterns were found
9. Write checkpoint file to VLDR_HOME/projects/{id}/checkpoints/
10. Git tag the checkpoint
11. Complete Volundr agent in the dashboard
12. Present final status report to the developer

Important:
- Do NOT skip the self-review phase - it is the most valuable part
- Do NOT clear activeProject - the SessionEnd hook handles that
- If the dashboard is unreachable, write the checkpoint file and summary to disk instead
- The session start time can be found from the Volundr agent's startedAt field
```

---

## 4. Integration with Existing Mechanisms

### SessionEnd hook (session-end.js)

The SessionEnd hook remains unchanged. It is the safety net.

```
Shutdown Protocol (runs first, while Volundr has context)
  |
  v  Volundr says "You can close this session."
  |
  v  Developer closes terminal / types /exit
  |
  v  SessionEnd hook fires (5s budget)
      - Completes any still-running agents (should be none after protocol)
      - Clears activeProject in registry
      - Logs session_ended event (idempotent - skips if already logged)
```

If the shutdown protocol ran successfully, the SessionEnd hook finds:
- Zero running agents (already completed in Phase 7)
- activeProject still set (hook clears it)
- session_ended event already exists (hook logs another - harmless duplicate)

If the shutdown protocol did NOT run (user killed terminal), the SessionEnd hook provides full mechanical cleanup as today.

### PreCompact hook (pre-compact.js)

No change needed. The shutdown protocol runs BEFORE compaction would be triggered. If the session is compacted during active work, PreCompact preserves state as today. The shutdown protocol is not part of the compaction flow.

### Session-start hook (session-start.js)

The crash recovery logic already handles the case where shutdown protocol didn't run. On next boot:
- Orphaned running agents are completed
- activeProject is treated as stale if still set

One enhancement: session-start.js could read the latest checkpoint file and include it in its log, giving the new session a pointer to where the old session left off.

### Stop hook (session-stop.js)

No change. The Stop hook correctly does nothing but log, per the lesson in `feedback_stop_hook.md`. The shutdown protocol does not interact with it.

---

## 5. Error Handling

### Dashboard is down

If API calls fail during the shutdown protocol:

| Phase | Fallback |
|-------|----------|
| Phase 1 (save work) | Git commits still work. Agent completion fails silently - session-start will clean up. |
| Phase 2 (gather metrics) | Volundr uses whatever data she has in context from the session. No API-sourced metrics. |
| Phase 3 (session summary) | Write to file instead: `VLDR_HOME/projects/{id}/reports/session-summary-{date}.md` |
| Phase 4 (journal) | Write to file: `VLDR_HOME/projects/{id}/reports/session-journal-{date}.md` |
| Phase 5 (self-review) | Still runs - Volundr reasons from in-context data. Lessons written to file. |
| Phase 6 (checkpoint) | Checkpoint file is written to disk regardless. Git tag still works. |
| Phase 7 (complete agents) | Fails silently. Session-start handles orphans on next boot. |
| Phase 8 (report) | Always works - it's just text output to the developer. |

**Implementation:** Wrap every API call in try/catch. Track a `dashboardAvailable` boolean. If any call fails, set it to false and switch all subsequent writes to file-based fallback.

### Mid-shutdown crash (user kills terminal during protocol)

- Whatever was written is written. Checkpoints and summaries that completed are persisted.
- Session-start crash recovery handles orphaned agents.
- Partial checkpoint files may exist but are still useful for context recovery.
- No data corruption possible - DB writes are atomic, file writes are append-only or create-new.

### Context window running low

If Volundr detects she's near the context limit during shutdown:
- Skip Phase 5 (self-review) - the most token-expensive phase
- Write a minimal checkpoint (just card statuses and next steps)
- Complete agents and exit
- The self-review can be done retroactively at the start of the next session by reading the checkpoint and session events

---

## 6. Token Cost Estimate

| Phase | Estimated tokens | Notes |
|-------|-----------------|-------|
| Phase 0: Acknowledge | ~100 output | One sentence |
| Phase 1: Save work | ~500 output + tool calls | Git commits, API calls |
| Phase 2: Gather metrics | ~200 input (API responses) | 6-8 API calls |
| Phase 3: Session summary | ~500-1000 output | Narrative generation |
| Phase 4: Journal entries | ~200-400 output | 1-3 entries |
| Phase 5: Self-review | ~1500-3000 output | Analysis + lesson creation |
| Phase 6: Checkpoint | ~500-800 output | Markdown file |
| Phase 7: Complete agents | ~200 output + tool calls | API calls |
| Phase 8: Final report | ~300-500 output | Formatted report |
| **Total** | **~4000-6500 output tokens** | Plus ~1000 input from API responses |

At Opus pricing ($25/MTok output, $5/MTok input):
- Output: 6,500 tokens = **$0.16**
- Input: 1,000 tokens = **$0.005**
- **Total: ~$0.17 per shutdown**

At Sonnet pricing ($15/MTok output, $3/MTok input):
- Output: 6,500 tokens = **$0.10**
- Input: 1,000 tokens = **$0.003**
- **Total: ~$0.10 per shutdown**

This is negligible compared to typical session costs ($5-50+). The self-review alone pays for itself if it prevents even one unnecessary retry in the next session.

---

## 7. What the Self-Review Writes

### Lesson structure

Each lesson follows this template:

```
Title: [Pattern|Antipattern|Efficiency|Process]: Short description
Content:
  Context: What happened during this session
  Finding: What worked / what didn't
  Evidence: Quality scores, retry counts, cost data
  Recommendation: What to do differently
  Applies to: [this project only | all projects]
Stack: [typescript | react | general | ...]
```

### Metrics Volundr reviews

| Metric | Source | What to look for |
|--------|--------|-----------------|
| `averageQualityScore` | `vldr.metrics.get()` | Session avg vs. all-time avg |
| `qualityTrend` | `vldr.metrics.get()` | Upward or downward slope |
| `retryRate` | `vldr.metrics.get()` | Should be < 10%. If higher, prompt templates need work |
| `cardsCompletedPerHour` | `vldr.metrics.get()` | Throughput baseline |
| `costByModel` | `vldr.metrics.get()` | Are we using expensive models when cheap ones would suffice? |
| `agentsByType` | `vldr.metrics.get()` | Too many fixers = bad prompts. Too many retries = wrong card size |
| `tokensByModel` | `vldr.metrics.get()` | Cache read ratio. Higher = more efficient |
| Build gate events | `vldr.events.list({ type: 'build_gate_failed' })` | Recurring patterns → constraints.md |
| Error events | `vldr.events.list({ type: 'error' })` | Tool failures, timeouts |

### What gets written where

| Insight type | Written to |
|-------------|-----------|
| Project-specific antipattern | `VLDR_HOME/projects/{id}/constraints.md` |
| Project-specific lesson | `vldr.lessons.create({ isGlobal: false })` |
| Broadly applicable lesson | `vldr.lessons.create({ isGlobal: true })` |
| High-scoring pattern (9.0+) | `VLDR_HOME/global/patterns/{name}.md` |
| Session narrative | `POST /api/session-summaries` |
| Checkpoint state | `VLDR_HOME/projects/{id}/checkpoints/checkpoint-{N}.md` |
| Journal observations | `POST /api/journal` |

---

## 8. System Instructions Update

Add this section to `framework/system-instructions.md` under "Developer Intervention Protocol":

```markdown
## Shutdown Protocol

When the developer says "stop", "goodnight", "pause", "wrap up", "shut it down",
or runs `/vldr-shutdown`, execute the graceful shutdown sequence:

1. Announce: "Starting shutdown protocol."
2. Commit any WIP on card branches
3. Complete all non-Volundr running agents
4. Gather metrics from dashboard
5. Write session summary (POST /api/session-summaries)
6. Write pending journal entries
7. Self-review: quality trends, retries, cost, patterns → write lessons
8. Write checkpoint file + git tag
9. Complete Volundr agent
10. Present final status to developer
11. Stop responding - developer closes session

If dashboard is unreachable, write summaries and checkpoint to files.
If context is low, skip self-review and write minimal checkpoint.

The SessionEnd hook handles mechanical cleanup (agents, registry) as a safety net.
```

---

## 9. New Event Types

Add two new event types to `@vldr/shared/enums.ts`:

```typescript
session_started: 'session_started',
session_ended: 'session_ended',
shutdown_started: 'shutdown_started',
```

These are already referenced in system-instructions.md but not yet in the EventType enum. Adding them provides type safety and enables dashboard filtering.

---

## 10. Dashboard Enhancement (Optional, Future)

### "Shutdown in progress" state

The dashboard could show a special state when Volundr's heartbeat reports `shutting_down`:
- Agent Tracker page: Volundr shows "Shutting down..." instead of "Running"
- Dashboard header: "Session ending - saving work..."
- This is purely cosmetic and can be added later

### Session History page

The `session_summaries` table already exists. A dashboard page that shows:
- Session timeline (when sessions started and ended)
- Cards completed per session
- Quality trend per session
- Cost per session
- Key decisions and blockers per session

This would give the developer a longitudinal view of project progress across sessions.

---

## 11. Implementation Priority

| Item | Priority | Effort |
|------|----------|--------|
| `/vldr-shutdown` command file | P0 | 5 min |
| Shutdown sequence in system-instructions.md | P0 | 10 min |
| EventType enum additions | P1 | 2 min |
| Session-start enhancement (read last checkpoint) | P2 | 15 min |
| Dashboard "shutting down" state | P3 | 30 min |
| Session History page | P3 | 2 hours |

The command file and system-instructions update are the only items needed to make this operational. Everything else is enhancement.

---

## 12. Design Decisions and Rationale

**Q: Why not make the shutdown protocol a hook?**
A: Hooks are Node.js scripts with no LLM context. The shutdown protocol requires reasoning, writing narratives, and making judgment calls about lesson promotion. These are inherently LLM tasks.

**Q: Why not extend the SessionEnd timeout to 60 seconds?**
A: Even with more time, the SessionEnd hook is a child process. It cannot write summaries, reason about quality trends, or create lessons. It would need the full SDK, metrics analysis logic, and narrative generation - essentially reimplementing Volundr in Node.js. The shutdown protocol runs in Volundr's existing context for free.

**Q: Should Volundr clear activeProject itself?**
A: No. The SessionEnd hook owns this. If Volundr clears it and then the hook fires, the hook would see null and skip cleanup - but if there were any edge cases (agents that became running between Volundr's check and the hook), they'd be orphaned. Letting the hook always clear ensures the safety net works.

**Q: What if the developer just closes the terminal without running shutdown?**
A: The SessionEnd hook fires (if it can - depends on how the terminal closes). If even that doesn't fire, session-start crash recovery handles everything on next boot. The only thing lost is the session summary and self-review - which is acceptable for a crash scenario.

**Q: Should the self-review be optional?**
A: No. It costs ~$0.10-0.17 and takes ~10-20 seconds. The insights it generates (lessons, antipattern detection, quality trend analysis) compound across sessions. Skipping it to save 15 seconds is a false economy. The only valid skip condition is context exhaustion (near the context window limit).

**Q: Should the shutdown protocol run on "pause" vs "stop"?**
A: Both trigger the same protocol. "Pause" implies returning later; "stop" implies ending for the day. The protocol is the same because the artifacts it produces (checkpoint, summary, lessons) are valuable in both cases. The only difference: on "pause", Volundr might say "Ready to resume when you are" instead of "Goodnight."
