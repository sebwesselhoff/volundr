---
name: "Git Workflow for Agent Teams"
description: "Volundr-specific git patterns: worktrees, selective staging, commit conventions for autonomous agents"
domain: "git"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "git"
  - "worktree"
  - "commit"
  - "branch"
  - "staging"
roles:
  - "developer"
  - "devops-engineer"
---

## Context
Agent Developer teammates operate in isolated git worktrees. Every Developer teammate MUST work
in a worktree — never directly on the main branch. This skill applies whenever you are committing
code, managing branches, or coordinating merges across parallel teammate worktrees.

## Patterns

**Worktree setup (handled by framework, but know the shape):**
- Worktrees live at `.claude/worktrees/{branch-name}/`
- Each teammate gets its own branch: `feat/CARD-XX-XXX-{slug}`
- Never commit to `main` directly from a teammate worktree

**Selective staging — always use explicit paths:**
```bash
git add framework/skills/parse-skill.ts framework/skills/skill-format.md
# NOT: git add . (too broad in shared repos)
# NOT: git add -A (picks up unrelated changes)
```

**Commit conventions:**
```
{type}: {description}

type = feat | fix | chore | docs | refactor | test
```
Examples:
- `feat: add SKILL.md parser with YAML frontmatter support`
- `fix: handle missing reviewByDate default in parse-skill`
- `chore: seed git-workflow-agents skill`

**Checking status before commit:**
```bash
git status
git diff --staged   # review exactly what is staged
```

**Pushing a teammate branch:**
```bash
git push origin feat/CARD-SK-002-skill-parser
```

## Examples

Full workflow for a Developer teammate implementing a card:

```bash
# 1. Verify you are in your worktree (not main)
git branch --show-current
# output: feat/CARD-SK-002-skill-parser

# 2. Do your work, then stage only your files
git add framework/skills/parse-skill.ts
git add framework/skills/skill-format.md
git add framework/skills/seeds/git-workflow-agents/SKILL.md

# 3. Confirm staging is clean
git diff --staged --stat

# 4. Commit with conventional message
git commit -m "feat: add SKILL.md format, parser, and seed skill"

# 5. Push
git push origin feat/CARD-SK-002-skill-parser
```

## Anti-Patterns

- **Never `git add .` in a shared worktree** — you will pick up other agents' in-progress files
- **Never `git commit --amend` after pushing** — breaks the branch for merge
- **Never force-push a teammate branch** — use a new commit to correct mistakes
- **Never commit directly to `main`** — all work goes through worktree branches
- **Do not stage files outside your card's domain** — if you see unexpected files in `git status`, do not add them
- **Do not use `--no-verify`** — hooks exist for a reason; fix the underlying issue instead
