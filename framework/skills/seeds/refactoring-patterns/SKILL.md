---
name: "Refactoring Patterns"
description: "Safe refactoring techniques: extract function, rename, decompose conditional, and test-first refactoring"
domain: "engineering"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "refactor"
  - "extract"
  - "rename"
  - "clean up"
  - "technical debt"
  - "readability"
roles:
  - "developer"
  - "reviewer"
---

## Context
Apply when improving existing code without changing its behavior. Refactoring is safest when done
in small, committed steps with tests green at every step.

## Patterns

**Refactor in isolation** — never mix refactoring commits with feature additions.
A commit that says "feat: add skill matching, also cleaned up parser" makes rollback impossible.

**Test first, then refactor** — if the code lacks tests, add characterization tests before changing
structure. Tests document the behavior you must preserve.

**Extract function** — when a code block has a clear purpose:
```typescript
// Before: inline comment signals extraction opportunity
const score = triggers.reduce((acc, t) =>
  queryTerms.some(q => t.includes(q)) ? acc + 2 : acc, 0);  // compute trigger score

// After: named function
function scoreTriggers(triggers: string[], queryTerms: string[]): number {
  return triggers.reduce((acc, t) =>
    queryTerms.some(q => t.includes(q)) ? acc + 2 : acc, 0);
}
```

**Replace magic numbers with named constants:**
```typescript
const TRIGGER_MATCH_WEIGHT = 2;
const NAME_MATCH_WEIGHT = 1;
```

**Decompose complex conditionals:**
```typescript
// Before
if (skill.roles.length === 0 || roles.some(r => skill.roles.includes(r))) { ... }

// After
const isAvailableToRoles = skill.roles.length === 0 || roles.some(r => skill.roles.includes(r));
if (isAvailableToRoles) { ... }
```

**Rename to intent** — variable names should say what they hold, not how they are computed.

## Examples

```bash
# Safe refactoring workflow
git status                 # confirm clean working tree
# make one structural change
npm test                   # confirm green
git add -p                 # stage only refactoring changes
git commit -m "refactor: extract scoreTriggers from match handler"
```

## Anti-Patterns

- **Refactoring untested code** — you will break something and not know it
- **Big-bang refactors** — rewriting a module in one commit makes review impossible
- **Renaming + moving + restructuring in one commit** — split into steps
- **Refactoring as procrastination** — don't polish code that is about to be deleted
- **Over-abstracting** — three uses of a pattern do not always justify an abstraction
