---
name: "Code Review Standards"
description: "What to look for in reviews, tone guidelines, blocking vs non-blocking feedback, and review checklists"
domain: "engineering"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "code review"
  - "pull request"
  - "pr review"
  - "feedback"
  - "review checklist"
roles:
  - "reviewer"
  - "developer"
  - "architect"
---

## Context
Apply when reviewing or preparing code for review. Good reviews catch bugs, spread knowledge, and
maintain consistency without becoming gatekeeping bottlenecks.

## Patterns

**Review checklist — check in this order:**
1. Does it solve the stated problem? (understand intent first)
2. Are there correctness bugs or edge cases?
3. Security implications (input validation, auth checks, secrets)
4. Performance (N+1, unnecessary work in hot paths)
5. Readability and naming (can a newcomer follow this?)
6. Tests — do they cover the new behavior?
7. Style (formatting, conventions)

**Distinguish blocking from non-blocking feedback:**
- `[blocking]` — must fix before merge (bug, security, missing test)
- `[suggestion]` — worth considering, but author decides
- `[nit]` — trivial style preference; do not block for nits

**Tone — critique the code, not the person:**
```
// Good
"This might cause a race condition when two requests come in simultaneously.
Could we use a transaction here?"

// Bad
"Why did you do it this way? This is obviously wrong."
```

**Ask questions before assuming bugs:**
"Is there a reason we're not using the existing `validateId` helper here?"

## Examples

Review comment template:
```
[blocking] The `DELETE /skills/:id` route returns 200, but the HTTP convention
for a successful delete is 204 No Content. This will confuse API clients.
```

## Anti-Patterns

- **Reviewing style when a linter exists** — configure Prettier/ESLint; don't comment on formatting
- **Approving without reading** — rubber-stamp approvals erode trust in the review process
- **Rewriting the whole PR in comments** — if you'd do it completely differently, discuss first
- **Nit-blocking** — holding up a PR for optional cosmetic preferences
- **Silent approval of unclear code** — ask for clarification rather than guessing intent
