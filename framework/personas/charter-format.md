# Persona Charter Format

Persona charters define the identity, scope, and working style of an agent role. They are loaded
as part of the Layer 2 system prompt when a persona is activated for a card.

## File Layout

```
framework/personas/seeds/{persona-id}/
  charter.md    — Static identity, constraints, and approach
  history.md    — Accumulated knowledge (project learnings, decisions, patterns)
```

For user-created personas (loaded from VLDR_HOME):
```
~/.volundr/personas/{persona-id}/
  charter.md
  history.md
```

---

## charter.md Format

```markdown
# {Name} — {Role}

> {One-line personality or approach — the "voice" of the persona}

## Identity
- **Name:** {display name}
- **Role:** {developer|architect|qa-engineer|devops-engineer|designer|reviewer|guardian|researcher}
- **Expertise:** {comma-separated domains}
- **Style:** {behavioral description — how this persona approaches work}
- **Model Preference:** {auto|sonnet|opus|haiku}

## What I Own
- {Primary responsibility 1}
- {Primary responsibility 2}
- {Primary responsibility 3}

## How I Work
- {Approach pattern 1}
- {Approach pattern 2}
- **{Hard rule — always/never — in bold}**

## Boundaries
**I handle:** {scope — what this persona takes on}
**I don't handle:** {anti-scope — explicit escalation targets, e.g. "security concerns → security-reviewer"}

## Skills
- (populated dynamically from persona_skills table at activation time)
```

### Guidelines

- The `>` quote line is the defining voice of the persona — make it specific and memorable
- **Style** should describe the behavioural texture, not just the job description
- **Hard rules** in "How I Work" use bold and use absolute language (always/never/must)
- **Boundaries** must name the escalation target explicitly, not just say "not my job"
- Keep charters between 30–50 lines
- No YAML frontmatter — plain markdown only
- Do not list skills inline in the charter; they are injected at activation time

---

## history.md Format

```markdown
# {Name} — Accumulated Knowledge

**Projects:** {count} | **Cards:** {count} | **Quality avg:** {score}

## Core Context
{Summarized key knowledge — kept under 4KB total, stack-tagged with [stack-tag]}

## Learnings
### {YYYY-MM-DD} — {project-name} [{stack-tag}]
{What was learned — concise, actionable}

## Decisions
### {YYYY-MM-DD} — {project-name}
{Architectural or implementation choice made and why}

## Patterns
{Recurring patterns this persona has observed or developed across projects}
```

### Guidelines

- The entire history.md should stay under 4KB to avoid bloating the context window
- Stack tags (e.g. `[nextjs]`, `[sqlite]`, `[docker]`) allow future filtering by tech stack
- New entries are prepended (most recent first) within each section
- Learnings are distilled — one lesson per entry, not a narrative
- The "Core Context" section is rewritten as a compact summary, not appended to
- history.md starts as an empty template (just the header); it grows through project work
