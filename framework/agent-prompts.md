# Agent Prompt Templates & Standard Formats

## Card Format
```markdown
# {CARD-ID}: {Title}

## Domain: {Domain}
## Parent SoW: {SoW reference}
## Priority: P0 | P1 | P2 | P3
## Size: S | M | L | XL
## Status: backlog | in_progress | review | testing | done | failed | skipped
## Dependencies: [CARD-XX-001] or none

## Description
{2-4 sentences.}

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Files to Create
- src/path/file.ts - {description}

## Files to Read (Context)
- src/existing/file.ts - {why needed}

## Technical Notes
{Patterns, conventions, constraints.}

## External Dependencies
- requires_env: [ENV_VAR_1, ENV_VAR_2]
- requires_service: [service-name]
- requires_db: true | false
```

### Card Sizing
| Size | Scope | Example |
|------|-------|---------|
| S | Single file, <50 lines | Add env variable, config fix |
| M | 1-3 files, 50-200 lines | Auth middleware + tests |
| L | 3-5 files, 200-500 lines | Full CRUD, multi-concern feature |
| XL | 5+ files, 500+ lines | Complex integrations, algorithms |

XL cards should be rare. Consider splitting if possible.

---

## Developer Agent Prompt Template (v2.2)

**Every developer agent prompt MUST follow this structure:**

```
You are implementing {CARD-ID}: {Title}.

## ENVIRONMENT CONSTRAINTS - DO NOT VIOLATE
{Paste from projects/{id}/constraints.md Agent Constraint Block}

## SHARED TYPE DEFINITIONS (DO NOT REDEFINE)
{Paste all relevant shared types/interfaces that this card consumes.
 These types are the contract - use them exactly as defined.
 If a type is missing something you need, note it in your completion report
 rather than inventing a new type.}

## CARD SPEC
{Full card spec from projects/{id}/cards/*.md}

## EXISTING CODE CONTEXT
{Paste relevant existing files inline - never ask agent to read files}

## CONVENTIONS
- Use TypeScript strict mode
- Use path alias @/* → ./src/*
- Import types from the shared type files, do not redefine them
- When consuming SSE/API responses, use the exact shapes from shared types
- When rendering values of type `unknown` in JSX, use `!!value` to coerce to boolean
- Always provide default values for optional fields: `data.field ?? defaultValue`
- {Any project-specific conventions}

## OUTPUT FORMAT
1. Write all files using the Write tool
2. Output a completion report listing:
  - Files created/modified
  - Acceptance criteria met (checkbox each)
  - Any decisions made and why
  - Shared types consumed (list which types from the shared definitions you used)
  - Any blockers or concerns

DO NOT use Bash. Write tool and Read tool ONLY.
```

### CRITICAL: Type Contract Rule

Before spawning agents that consume shared types, ensure the types card is **Done** and its output is included inline in the consumer agent's prompt. This prevents the #1 source of post-merge TypeScript errors: independently-defined types that don't match.

**Bad:** Spawn 4 agents simultaneously - types agent + 3 consumer agents (prompted before types exist)
**Good:** Spawn types agent → wait for completion → spawn consumer agents with types inline

---

## Dev Report Format
Written to `projects/{id}/reports/dev-{CARD_ID}.md`:
```markdown
# Dev Report: {CARD-ID}
## Status: complete | blocked
## Completed: {timestamp}
## Implementation: direct | agent

## Files Created / Modified
- path (created/modified) - description

## Decisions Made
- Decision and rationale

## Acceptance Criteria Results
- [x] Criterion - where implemented
- [ ] Criterion - BLOCKED: reason

## Quality Self-Score (supplementary — blind reviewer provides official score)
- Completeness: X/10
- Code Quality: X/10
- Format Compliance: X/10
- Correctness: X/10
- **Total: X.X/10**

## Build Gate Results
- tsc --noEmit: PASS | FAIL
- Smoke test (if UI): PASS | FAIL | N/A
- Antipattern grep: CLEAN | {findings}

## Blockers
None | description
```

## Test Report Format
Written to `projects/{id}/reports/test-{CARD_ID}.md`:
```markdown
# Test Report: {CARD-ID}
## Verdict: PASS | FAIL

## Test Files
- tests/path/file.test.ts

## Results Per Criterion
1. Criterion - PASS | FAIL - detail

## Edge Cases
- Case - result

## Issues Found
None | description
```

## SubOrchestrator Prompt Pattern (PROVEN - use this exact pattern)

```
Output a JSON array of task cards for the {DOMAIN} domain.

[Paste ALL relevant context inline - stack, conventions, types, etc.]
[Paste relevant constraints from projects/{id}/constraints.md]

Output ONLY the raw JSON array. No markdown fences, no explanation.
Start with [ end with ].

Each card object must have these exact keys:
- id: "CARD-{PREFIX}-001" format
- title: short title
- size: "S"|"M"|"L"|"XL"
- priority: "P0"|"P1"|"P2"|"P3"
- deps: array of card IDs or empty array
- description: 2-3 sentences
- criteria: array of acceptance criteria strings
- files_to_create: array of "path - description" strings
- technical_notes: one sentence

Generate exactly N cards:
1. CARD-XX-001: [exact description]
2. CARD-XX-002: [exact description]
```

Key rules:
- ALL context inline (never "read this file")
- JSON only output (no prose)
- Exact card specs provided (don't let agent decide scope)
- Save prompt to `projects/{id}/prompts/` for replay

## Blueprint Format
```markdown
# Project Blueprint: {Name}

## Overview
- **Pitch:** one sentence
- **Target User:** who
- **MVP Scope:** core features
- **Non-Goals:** what we're NOT building

## Tech Stack
| Layer | Choice | Rationale |
|-------|--------|-----------|

## Architecture
{System description, data flow, key decisions.}

## Domain Decomposition
| Domain | SoW File | Priority | Description |
|--------|----------|----------|-------------|

## Cross-Domain Contracts
{Shared types, API interfaces, conventions.}

## Developer Preferences
{Style, formatting, constraints.}
```

## SoW Format
```markdown
# SoW: {Domain}
## Scope
## Deliverables
## Constraints
## Dependencies
## Acceptance Criteria
```
