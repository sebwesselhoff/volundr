# Two-Level Hierarchy Pattern

**When:** 6+ cards
**Who:** Volundr (team lead) + teammates

---

## Teammate Roster

| Role | Count | Condition | Responsibilities |
|------|-------|-----------|-----------------|
| Developer | 1-4 | Always (one per domain) | Claims tasks, implements directly in worktrees, runs build gates |
| Architect | 1 | Always | Continuous design review - reviews specs before implementation, reviews completed work after |
| QA Engineer | 1 | When tests are in scope | Writes and runs tests alongside development |
| DevOps Engineer | 1 | When infra/deploy cards exist | Handles CI, infra, deployment cards |
| Designer | 1 | When frontend cards exist | Owns UI/UX cards, ensures visual consistency |
| Reviewer | 1 | When cross-domain deps > 5 | Cross-domain consistency review |
| Researcher | 1-2 | When external APIs need investigation | Investigates unknowns, produces findings for developers |
| Guardian | 1 | Milestone-only | Domain completion, every 15 cards, before final integration |

All teammates have full CLI: Agent tool + Bash + Read/Write/Edit/Glob/Grep.

Developer teammates use `framework/agents/prompts/suborc-teammate.md` template.

---

## Execution Loop

1. Volundr partitions cards by domain
2. Vǫlundr creates tasks in shared task list (one per card, `CARD-XX-NNN: title`)
3. Vǫlundr spawns teammates: Developers + Architect + any applicable conditionals
4. Teammates claim tasks and work independently
5. Developers implement in worktrees, run build gates (`npx tsc --noEmit` per worktree)
6. Architect reviews specs before implementation begins and reviews completed work after
7. QA Engineer writes and runs tests alongside development
8. Volundr monitors via dashboard, handles pending commands, resolves blockers
9. After all teammates idle: merge worktree branches to main in dependency order
10. Final build gate on main: `npx tsc --noEmit`
11. Quality score each completed card via `vldr.quality.score(...)`
12. Re-assess: scale down to flat if ≤2 cards remain
13. Check for newly unblocked domains - if found, repeat from step 3

---

## Scaling

- **Scale down to flat** if only 2 cards remain after a round
- **Spawn Reviewer mid-flight** if cross-domain deps grow past 5 during execution
- **Cost warning** at 80% of budget ceiling
- **Pause all teammates** at budget ceiling - wait for user approval before continuing

---

## Cost Profile

- Moderate - teammate context window overhead per domain
- ~$0.50-2.00 per card
- ~1.5-2x flat cost due to teammate overhead
