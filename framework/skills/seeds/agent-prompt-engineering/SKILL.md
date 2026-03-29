---
name: "Agent Prompt Engineering"
description: "Structured prompts for autonomous agents: role, context, constraints, output format, and iteration patterns"
domain: "agent"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "prompt"
  - "agent"
  - "system prompt"
  - "llm"
  - "instruction"
  - "persona"
  - "context injection"
  - "prompt engineering"
roles:
  - "architect"
  - "developer"
  - "researcher"
---

## Context
Apply when writing system prompts, agent instructions, or card descriptions that will be executed by
autonomous agents. Well-structured prompts reduce ambiguity, improve output quality, and make
agent behavior predictable.

## Patterns

**Structured prompt anatomy:**
1. **Role** — who the agent is, its area of expertise
2. **Context** — what project/task/situation it's operating in
3. **Constraints** — what it must not do, boundaries, format requirements
4. **Task** — clear, specific instruction in imperative form
5. **Output format** — exact structure expected

**Be explicit about what NOT to do:**
- "Do not create files outside your card's domain"
- "Do not modify files that were not listed in the card"
- "Do not use `git add .`"

**Decompose complex tasks** — one clear action per instruction. Parallel tasks go to parallel agents.

**Include examples for non-obvious formats:**
```
Output format (JSON):
{ "decision": "approved" | "rejected", "reason": "string", "suggestions": ["string"] }
```

**Ground agents with references** — point to existing code patterns rather than describing them:
"Follow the pattern in `framework/skills/seeds/git-workflow-agents/SKILL.md`"

**Iterative prompting** — for long tasks, include checkpoints:
"After completing the schema, read it back to verify all required fields are present before proceeding to the API routes."

## Examples

```markdown
You are a Developer teammate implementing CARD-SK-001 (Skills DB schema + API).

Context: Volundr v5 Sprint 2. The existing pattern for DB + API is in
`packages/db/src/schema.ts` and `packages/api/src/routes/lessons.ts`.

Constraints:
- Work only in your worktree branch `feat/CARD-SK-001-skills-api`
- Stage only files in your domain: db/schema.ts, api/routes/skills.ts, sdk/resources/skills.ts
- Do not modify unrelated routes

Task: Add a `skills` table to the DB schema, implement CRUD + match API routes,
create the SDK resource, and wire everything into index.ts.
```

## Anti-Patterns

- **Vague instructions** — "Add skills support" gives the agent too much latitude
- **No output format** — agents fill gaps with guesses that diverge from expectations
- **Contradictory constraints** — "be thorough" + "be concise" without priority ordering
- **Missing file references** — "follow existing patterns" without saying which files to look at
- **No stopping condition** — agents that don't know when they're done keep working or hallucinate completion
