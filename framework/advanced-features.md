# Advanced Features - Volundr v5.0

Read at startup alongside CLAUDE.md.

## 1. Event Log
Log via SDK: `vldr.events.log({ type, detail, cardId?, agentId?, costEstimate? })`. Events are stored in the Dashboard DB and visible in real-time on the Events page.

Types: agent_spawned, agent_completed, agent_timeout, card_status_changed, quality_scored, retry_triggered, branch_merged, optimization_cycle, milestone_reached, intervention, checkpoint_created, error, build_gate_failed, build_gate_passed, antipattern_found, state_saved, command_received, command_acknowledged, session_started, session_ended, shutdown_started

## 2. Live Status
Status is **derived from the Dashboard DB** - no manual status.md writes needed. The Dashboard home page shows active agents, card progress, quality scores, costs, and recent events in real-time.

## 3. Developer Interventions
Handle: manual implementations, skips, file modifications, overrides, pause/resume.
After any intervention: verify board + deps + event log consistency.

## 3.1 Shutdown Protocol
When developer says "stop", "pause", "goodnight", or runs `/vldr-shutdown`: execute the graceful shutdown sequence from `framework/shutdown-protocol.md`. Saves work, writes session summary, performs self-review (quality trends, retries, cost), creates lessons, writes checkpoint, and presents final status. Runs BEFORE session ends while Volundr has full context. SessionEnd hook handles mechanical cleanup after.

## 4. Checkpoints
Auto-create at: domain completion, every 10 cards, pause.
Write to `VLDR_HOME/projects/{id}/checkpoints/checkpoint-{N}.md`.
Git tag: `checkpoint-{N}`

## 5. Cross-Project Memory
Load lessons via `vldr.lessons.list({ isGlobal: true })` at startup.
Promote lessons via `vldr.lessons.create({ ..., isGlobal: true })` at completion.
Save reusable patterns from 9.0+ cards to `VLDR_HOME/global/patterns/`.

## 6. Architecture Guardian
Spawn via Agent tool at milestones. Reviews entire codebase.
Write to `VLDR_HOME/projects/{id}/reports/guardian-review-{N}.md`.
Create cards for critical issues.

## 7. Auto-Docs & Retrospective
At completion: spawn doc agent (Agent tool), write retrospective yourself.
Append to global lessons.

## 8. Agent Replay
All prompts in `prompts/`, outputs in `reports/`. Developer can request replay or re-run.

## 9. Dashboard (MANDATORY - Start During Boot Sequence)

**Start during the Fast-Track Boot Sequence (Step 3), not as an afterthought.**

```bash
cd dashboard && npx turbo dev &
# → API: http://localhost:3141  |  Web UI: http://localhost:3000
```

Enterprise dashboard with real-time monitoring. SQLite-backed via Drizzle ORM. WebSocket for live updates. 7 pages: Dashboard overview, Kanban board, Agent tracker, Agent tree, Metrics/charts, Event log, Settings. Interactive - pause/resume, skip/retry cards from the UI. Volundr and SubOrchestrators write data via the `@vldr/sdk` client library.

**v5 Agent Hierarchy - visible in real-time on the Agent Tree page:**
```
Volundr (opus) - project lifecycle, git, cross-domain deps
  ├── Planner (opus) - card breakdown per domain
  ├── SubOrchestrator (opus) - domain executor, spawns workers
  │   ├── Developer (sonnet) - code, worktree isolation
  │   ├── Tester (sonnet) - tests
  │   ├── Reviewer (opus) - code review, read-only
  │   ├── Content (sonnet) - docs
  │   └── Fixer (haiku) - build-gate patches
  └── Guardian (opus) - cross-domain architecture review
```

Prompt templates: `framework/agents/*.md` | Registry: `framework/agents/registry.ts`

**Why mandatory:** In the CrowdTwist project, the dashboard was never started. This meant zero visual tracking of progress, no event feed, and no quality overview. The developer had no quick-glance status. Starting the dashboard takes 5 seconds and provides continuous value for the entire session.

## 10. State Persistence
State is persisted in the Dashboard DB via SDK calls. No flat-file state.json needed.
Recovery: `vldr.project.get()` + `vldr.cards.list()` + `vldr.agents.list()` to reconstruct full state.
See `system-instructions.md` "State Persistence" section for details.

## 11. Plugins
- **frontend-design**: Auto-activates on frontend work. No configuration needed.
- **superpowers**: TDD, debugging, brainstorming, code review skills.
  See CLAUDE.md "Plugins & Integrations" for interaction rules.

## 12. Worktree Isolation
Use `isolation: "worktree"` in Agent tool calls for parallel developer agents.
Each agent gets an isolated copy of the repo. Volundr merges after completion.
Use for: parallel cards, retry branches. Skip for: sequential cards, shared config files.

## 13. Sub-Orchestrator Model
For 50+ card projects, Root MC assigns SoWs to SubOrchestrators running in worktrees. Only Root MC holds shell permissions. This model is partially realized via the decoupled framework structure: each project lives under `VLDR_HOME/projects/{id}/`, enabling independent orchestration contexts.
