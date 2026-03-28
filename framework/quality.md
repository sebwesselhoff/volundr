# Agent Quality & Self-Optimization System

## Scoring Rubric (1-10)

| Dimension | Weight | 1-2 | 5-6 | 9-10 |
|-----------|--------|-----|-----|------|
| Completeness | 3x | Missing most | All files, some gaps | Every criterion met |
| Code Quality | 3x | Broken, no types | Works, reasonable | Clean, idiomatic |
| Format Compliance | 2x | Ignored format | Mostly followed | Perfect |
| Correctness | 2x | Logic broken | Works, some edge cases | Handles all cases |

Score = (C×3 + Q×3 + F×2 + R×2) / 10

## Review Types

Every card gets TWO scores:
1. **Self-score** (`reviewType: "self"`) — implementer's self-assessment, logged as supplementary
2. **Reviewer score** (`reviewType: "reviewer"`) — blind reviewer agent, this is the OFFICIAL score

The quality gate checks the reviewer score. If no reviewer score exists, falls back to self-score.

A **blind reviewer agent** (read-only, Haiku model) is spawned after each card completes:
- Reads: card spec, ISC criteria, git diff, changed file contents
- Never sees the developer's self-score
- Scores each ISC criterion as pass/fail with evidence
- Scores the 4 dimensions independently
- Reviewer score is the official quality score

## Thresholds
| Score | Rating | Action |
|-------|--------|--------|
| 9.0+ | Excellent | Flag as reference |
| 7.0+ | Good | Accept, note improvements |
| 5.0+ | Needs Work | Fix issues, optimize for next time |
| <5.0 | Poor | Fix immediately |

## Self-Scoring
When Vǫlundr implements directly, self-score with tag `direct`.
This keeps the quality log meaningful even without external agents.

## Optimization Cycle (every 5 cards)
1. Analyze quality trends via `vldr.metrics.get()` (qualityTrend, averageQualityScore)
2. Identify patterns (low-scoring card types, problematic domains)
3. Log insights via `vldr.lessons.create({ title, content, stack })`
4. Adjust SubOrchestrator prompts for next batch

## Retry (for Agent tool sub-agents)
- Level 1: Add failure analysis to prompt
- Level 2: Full prompt rewrite with examples
- Level 3: Escalate to developer

---

## Build Gate (MANDATORY - per agent AND per card)

**Run after EVERY agent completes, not just at card boundaries.**

In the CrowdTwist project, errors compounded when build gates were only run after batches. Running `tsc --noEmit` after each individual agent caught errors at 14 total across 4 check runs. Catching them immediately is cheaper than fixing them later.

### 1. Type Check (after every agent)
```bash
npx tsc --noEmit
```
Must exit 0. If it fails, fix before merging the agent's output or spawning the next agent.

### 2. Smoke Test (UI cards only)
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/{affected-route}
```
Must return 200. A 500 means runtime errors the type checker missed.

### 3. Antipattern Grep (after every agent)
After every agent writes code, grep for known-bad patterns from `constraints.md`:
- Check for all patterns in the Discovered Antipatterns table
- Check for circular CSS variable references: `var(--font-` self-referencing
- Check for `new Date()` in non-client components
- Check for `value={` without `?? ` default
- Check for redefined types that should be imported from shared files
If any match, fix before committing.

### 4. Card Completion Manifest
Write `projects/{id}/reports/manifest-{CARD-ID}.json` after passing all gates.

### 5. Spotcheck Gate (per parallel round - MANDATORY)

After all teammates idle and before merging branches to main:
1. Reviewer spotcheck runs against all completed branches from this round
2. BLOCK findings are merge blockers - must be fixed first
3. WARN/INFO findings are logged as events
4. Guardian flags missing spotcheck events at milestone review (audit trail)
