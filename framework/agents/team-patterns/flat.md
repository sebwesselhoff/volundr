# Flat Hierarchy Pattern

**When:** ≤5 cards, OR only 2 cards remaining during two-level execution, OR budget exceeded
**Who:** Vǫlundr only (no teammates)

---

## How Vǫlundr runs flat mode

1. **No Agent Teams.** Vǫlundr implements cards directly using Agent tool subagents.
2. **Execution loop:**
   a. Pick the next unblocked card (all deps are done)
   b. Spawn a developer subagent (Agent tool, `isolation: "worktree"`, model: sonnet)
     - Use `framework/agents/prompts/developer-subagent.md` template
     - Include full card spec, shared types, constraints inline
   c. When subagent returns, run build gate: `npx tsc --noEmit` in worktree
   d. If build gate fails: spawn fixer subagent (haiku), max 2 attempts
   e. Merge worktree branch to main: `git merge {branch} --no-ff`
   f. `git tag card-{ID}-done`
   g. `vldr.quality.score(...)` for the card
   h. Repeat from (a)
3. **Parallelism:** Max 3 concurrent developer subagents for independent cards
4. **No Reviewer or Guardian teammates** - Vǫlundr reviews her own output
5. **Build gate runs after each card** - Vǫlundr handles this via Bash

## When to use
- Very small projects (3-5 cards)
- Tail end of large projects (only 2 cards left)
- Budget ceiling hit - minimize spend
- Agent Teams unavailable

## Cost profile
- Lowest cost - no teammate context window overhead
- ~$0.10-0.50 per card depending on complexity
