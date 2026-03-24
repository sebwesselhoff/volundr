# Volundr - Autonomous Agent Orchestration for Claude Code

## Quick Start

Read `framework/system-instructions.md` - this is your operating manual.

The framework checks `VLDR_HOME/projects/registry.json` on boot to determine which project to load. Start the dashboard first (`start.bat` or `start.sh`), then open Claude Code in this directory.

> **VLDR_HOME** defaults to `~/.volundr`. All user data (projects, lessons, DB) lives there - not in this repo.

## Directory Layout

```
volundr/              (this repo - framework, shareable)
├── framework/             - System instructions, templates, quality rubric
├── framework/lessons/     - Community lessons seed file (shared via git)
├── dashboard/             - The Forge dashboard (Turborepo monorepo)
├── .claude/hooks/         - Claude Code lifecycle hooks
├── start.bat / start.sh   - One-click launchers (Docker + Claude CLI)
└── CLAUDE.md              - This file

~/.volundr/           (VLDR_HOME - user data, private)
├── projects/              - Per-project state (registry.json + project dirs)
│   └── {id}/              - blueprint.md, constraints.md, reports/, checkpoints/, etc.
├── global/                - Cross-project lessons, patterns, history
│   ├── lessons.md         - Aggregated lessons
│   ├── patterns/          - Reusable patterns from high-scoring cards
│   └── project-history.md - Summary of all completed projects
└── data/                  - Dashboard SQLite DB (bind-mounted into Docker)
```

### Framework Files (in repo)

- `framework/system-instructions.md` - Your system instructions (read first)
- `framework/lessons/seed.json` - Community lessons (seeded into DB on boot)
- `framework/hierarchy-config.ts` - Dynamic hierarchy thresholds and types
- `framework/hierarchy-assessor.ts` - Auto-select flat/two/three-level hierarchy
- `framework/agent-prompts.md` - Card/report/SoW templates
- `framework/quality.md` - Scoring rubric, build gates, and retry system
- `framework/advanced-features.md` - Event log, checkpoints, guardian, dashboard, plugins
- `framework/machine-constraints.md` - Machine environment (auto-detected)

### Project Files (in VLDR_HOME, per project under `projects/{id}/`)

- `constraints.md` - Project-specific constraints (populated during CARD-000)
- `blueprint.md` - Project blueprint (created after Discovery Interview)
- `cards/`, `reports/`, `checkpoints/`, `sow/`, `prompts/`

### Community Lessons

- `framework/lessons/seed.json` - shipped with the framework, imported on API boot
- Users contribute lessons back via `GET /api/lessons/export` -> update seed.json -> PR
- `vldr.lessons.export()` in the SDK returns all global lessons in seed format

## Delegation

Two mechanisms: **Agent Teams teammates** for Developers/Architect/QA/DevOps/Designer/Reviewer/Guardian/Researcher (full CLI), **Agent tool subagents** for Developers/Testers/Content/Fixers/Planners (limited tools).

- **Volundr** (team lead) spawns: Developer teammates, Architect teammate, conditional specialist teammates, and direct subagents for small tasks
- Developer subagents use Read/Write/Edit/Glob/Grep only - no Bash, no Agent tool
- All Developer teammates use worktree isolation - mandatory
- Teammate prompt templates: `framework/packs/*/prompts/*.md`
- Agent registry: `framework/agents/registry.ts`

## Parallelism

- Cost gating - Volundr estimates before spawning, pauses at gate level 2+
- Per-project limits: max 4 Developer teammates concurrent
- Max 12 teammates total (Volundr + 11 others)
- Multiple Developer teammates run in parallel (one per domain)
- Volundr handles cross-domain deps between rounds

## Permissions

Run with `claude --dangerously-skip-permissions` for autonomous operation.
