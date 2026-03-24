# Inter-Agent Communication Patterns

How agents communicate within Agent Teams. All teammates share a mailbox messaging system - messages are delivered automatically between teammates without Volundr relaying.

---

## How to Send Messages (CRITICAL)

Teammates MUST use the `SendMessage` tool to communicate. Text output is **invisible** to other agents.

```
SendMessage({ to: "teammate-name", message: "Your detailed message here" })
```

- **Direct message:** `SendMessage({ to: "suborc-backend", message: "CARD-BE-001 is done." })`
- **Broadcast to all:** `SendMessage({ to: "*", message: "Shared types changed in types.ts" })`
- **Message Volundr (lead):** `SendMessage({ to: "volundr", message: "Domain complete. 5/5 cards done." })`

**WARNING:** Broadcast (`to: "*"`) is expensive - sends N messages for N teammates, consuming tokens in each context window. Use direct messages when possible.

**Checking messages:** Messages arrive automatically in your context. Check for new messages before claiming each new task.

---

## Message Types

### 1. Domain Signals (Volundr ↔ SubOrc)

| Signal | From | To | When | Format |
|--------|------|----|------|--------|
| Cards Ready | Volundr | SubOrc | After creating tasks | "Your domain tasks are ready in the shared list. Claim tasks prefixed CARD-{PREFIX}-." |
| Domain Complete? | Volundr | SubOrc | Checking progress | "Status check - how many cards remaining?" |
| Domain Complete | SubOrc | Volundr | All domain tasks done | "Domain {DOMAIN} complete. {N}/{N} cards done. Branches: [list]" |
| Blocked | SubOrc | Volundr | Cross-domain dep not met | "CARD-{ID} blocked on CARD-{DEP-ID} (different domain). Cannot proceed." |
| Build Failed | SubOrc | Volundr | Card failed after retries | "CARD-{ID} failed after 2 fix attempts. Error: {tsc output truncated to 200 chars}" |

### 2. Coordination Signals (SubOrc ↔ SubOrc)

| Signal | When | Format |
|--------|------|--------|
| Shared Types Changed | After modifying shared types | "I modified {file} in CARD-{ID}. If you import from this file, rebase your worktrees before building." |
| File Lock Request | Before editing shared file | "I'm about to edit {file} for CARD-{ID}. Hold off if you're editing it too." |
| File Lock Release | After committing shared file change | "Done editing {file}. You can proceed." |
| Rebase Needed | After Volundr merges to main | "Main branch updated with CARD-{ID}. Rebase active worktrees if they touch {files}." |

### 3. Review Signals (Reviewer ↔ SubOrc)

| Signal | When | Format |
|--------|------|--------|
| Issue Found | After reviewing completed card | "CARD-{ID} issue: {description}. File: {file}:{line}. Fix: {suggestion}." |
| Critical Issue | Blocks merge | "CRITICAL: CARD-{ID} has {issue}. Do NOT merge. Fix required." |
| Review Passed | Card is clean | (No message needed - absence of issue = passed) |
| Fix Confirmed | After SubOrc fixes issue | "Fixed CARD-{ID} per review feedback. Re-check {file}:{line}." |

### 4. Control Signals (Volundr → All)

| Signal | When | Format |
|--------|------|--------|
| Pause | Dashboard command or budget warning | "PAUSE - finish your current card, then stop claiming new tasks." |
| Resume | Dashboard command | "RESUME - continue claiming tasks from the shared list." |
| Scale Down | Reducing teammates | "SCALE DOWN - {teammate-name}, finish current work and go idle." |
| Emergency Stop | Critical failure | "STOP - cease all work immediately. Do not commit." |

---

## Shared-File Conflict Resolution

When multiple agents may edit the same file, follow this protocol:

### Prevention (preferred)

1. **Worktree isolation** - developer subagents ALWAYS use `isolation: "worktree"`. They cannot conflict with each other.
2. **Card scope** - each card specifies which files it touches. Volundr ensures cards touching the same files are in the same domain (same SubOrc) or sequenced.
3. **Shared files on main** - files touched by many cards (package.json, tsconfig.json, config files) are edited by Volundr directly on main, never in parallel branches.

### Detection

If a merge conflict occurs during Volundr's merge phase:

1. Volundr identifies conflicting files and cards
2. Vǫlundr reads both versions and the base
3. If the conflict is additive (both add to the same file but different sections) → Volundr resolves manually
4. If the conflict is contradictory (both modify the same lines differently) → Volundr re-implements the later card against the updated main

### Recovery

1. Volundr keeps the earlier card's changes (already merged)
2. Vǫlundr creates a new worktree from updated main
3. Volundr re-spawns the later card's developer subagent with updated context
4. The re-spawned agent implements against the current state

---

## Cross-Domain Dependency Signaling

When a card in domain A depends on a card in domain B:

### At planning time
- Volundr identifies cross-domain deps during card breakdown
- These deps are in the card's `deps` field
- Volundr sequences domains: domain B's blocking card completes before domain A starts

### At runtime
- If SubOrc-A encounters a blocked card:
  1. SubOrc-A messages Vǫlundr: "CARD-A-003 blocked on CARD-B-001 (different domain)"
  2. Volundr checks CARD-B-001 status
  3. If done → Volundr tells SubOrc-A: "CARD-B-001 is done, proceed with CARD-A-003"
  4. If not done → Volundr tells SubOrc-A: "Skip CARD-A-003 for now, work on other unblocked cards"
  5. When CARD-B-001 completes → Volundr messages SubOrc-A: "CARD-B-001 done. CARD-A-003 is now unblocked."

### Between rounds
- After each round of merges, Volundr re-evaluates cross-domain deps
- Newly unblocked cards trigger new tasks in the shared list
- SubOrcs are messaged to claim new tasks

---

## Review Feedback Loop

```
1. Developer subagent completes card in worktree
2. SubOrc runs build gate (tsc)
3. SubOrc marks task complete
4. Reviewer teammate detects completion
5. Reviewer diffs the branch: git diff main...{branch}
6. IF issues found:
   a. Reviewer messages SubOrc: "CARD-{ID} issue: {details}"
   b. SubOrc spawns fixer subagent (or re-opens the card)
   c. Fixer commits fix to the same worktree branch
   d. SubOrc re-runs build gate
   e. SubOrc messages Reviewer: "Fixed CARD-{ID}. Re-check."
   f. Reviewer re-reviews → loop back to step 6 or continue
7. IF clean: no message needed
8. Volundr merges the branch to main
```

---

## Plan Approval Gate

For complex domains, Volundr requires plan approval before a teammate makes changes.

**Spawn with `mode: "plan"`:**
```
Agent({
  name: "guardian",
  team_name: "mc-project",
  mode: "plan",
  model: "opus",
  prompt: "You are the Architecture Guardian...",
  run_in_background: true
})
```

**Protocol flow:**
1. Teammate reads the card specs and codebase
2. Teammate writes a plan (which files to create/modify, approach)
3. Teammate sends `plan_approval_request` → goes idle waiting for approval
4. Vǫlundr receives the plan in her inbox automatically
5. Volundr uses `approvePlan` or `rejectPlan` (with feedback) via TeammateTool
6. On approve → teammate proceeds with implementation
7. On reject → teammate revises based on feedback and re-submits

**Use plan mode for:**
- Guardian and Reviewer teammates (always)
- Security-sensitive domains (auth, payments)
- Domains with complex cross-cutting concerns
- First card in a new domain (to validate the approach)

---

## Shutdown Protocol

Volundr uses the TeammateTool to gracefully shut down teammates:

```
1. Vǫlundr: requestShutdown({ target_agent_id: "suborc-backend@team", reason: "Domain complete" })
2. Teammate receives shutdown_request in inbox
3. Teammate finishes current card (won't abandon mid-work)
4. Teammate: approveShutdown({ request_id: "..." })
   OR: rejectShutdown({ request_id: "...", reason: "Still have 2 cards remaining" })
5. If approved: teammate shuts down. If rejected: Vǫlundr decides whether to re-request or wait.
```

**When to shut down:**
- Domain is complete - all cards done and merged
- Scale-down command from dashboard
- Budget threshold reached
- Emergency stop (use broadcast STOP message first, then shutdown)

**Important:** Always clean up the team via `cleanup` operation AFTER all teammates are shut down. Never clean up while teammates are active.

---

## Idle Notification Handling

When a teammate goes idle (finishes all claimed tasks), Volundr automatically receives an `idle_notification` message.

**Volundr's response to idle notifications:**
1. Check if there are unblocked tasks remaining in the shared task list
2. If yes → message the idle teammate to claim more tasks
3. If no → check if all domains are complete
4. If all complete → begin merge phase (Phase 4 step 9)
5. If other domains still running → wait for them

---

## CLAUDE.md Patterns for Teammates

Teammates inherit the project's `.claude/settings.json` (hooks, env vars) and can read CLAUDE.md. Include these patterns in CLAUDE.md or constraints.md for teammate guidance:

```markdown
## Communication Rules (for Agent Teams teammates)

- Use `SendMessage({ to: "volundr", message: "..." })` to message Volundr
- Use `SendMessage({ to: "suborc-backend", message: "..." })` for specific teammates
- Use `SendMessage({ to: "*", message: "..." })` to broadcast (expensive - avoid unless necessary)
- Message Volundr when: blocked, domain complete, build failed after retries
- Message other SubOrcs when: you modified a shared file they might import
- Do NOT message for: routine progress (hooks handle this automatically)
- Message format: always include the card ID, file path, and a one-line summary
- Check messages before claiming each new task - messages arrive automatically
```
