# Changelog

## v5.0.0 — 2026-03-27

Major release: quality scoring overhaul, persona system, blind card reviewer, Agent Teams lifecycle, and dashboard improvements.

### Quality System

- **1-10 scoring scale** — migrated from 1-5 for better granularity; all thresholds, rubrics, and UI updated
- **Blind card reviewer** — independent Haiku agent scores cards without seeing self-score; prompt template at `framework/packs/quality/prompts/card-reviewer.md`
- **Dual quality scores** — self-review + reviewer scores shown side-by-side in compliance heatmap with S/R/H tooltip badges
- **Correctness dimension** — replaces `independence`; formula: `(C*3 + Q*3 + F*2 + R*2) / 10`
- **Production build gate** — added `next build` / `vite build` step after UI cards to catch runtime errors tsc misses

### Persona System

- **21 Viking-named personas** — Norse mythology-themed roster: Tyr (architect), Heimdall (auth), Mimir (database), Skuld (data), Brokkr (devops), Saga (docs), Baldr (fullstack), Ran (migration), Vidarr (security), Forseti (QA), Idunn (frontend), Hermodr (API), Sigyn (Python), Sleipnir (mobile), Skadi (cloud), Magni (performance), Huginn (AI/ML), Hodr (accessibility), Muninn (researcher), Eitri (.NET), Freyja (SEO)
- **Three-tier discovery** — user-created (DB) > pack-installed (DB) > built-in roster; Map-based merge with same-ID override
- **Persona builder** — full creation form in `/personas` dashboard page: name, auto-ID, role (dropdown + custom), expertise tags, trait toggles, style, model preference
- **Override mode** — create-new vs override-built-in with dropdown of all 21 personas
- **Live persona stats** — cardsCompleted, qualityAverage, totalTokens, totalCost, lastActiveAt, skillCount, reliability computed from agent history
- **Persona skills** — extracted from agent work, written to `persona_skills` junction table
- **Expertise radar** — replaced static axes with data-driven skills/reliability from agent history

### Agent Lifecycle

- **Unified agent tracking** — hooks extract cardId + personaId from prompts; no more manual registration or phantom agents
- **Volundr heartbeat** — auto-registers on session start, live status updates showing spawned agents and card progress
- **Agent detail in dashboard** — agents tab shows detail/cardId columns, Volundr heartbeat visible
- **Model normalization** — 10 API model name variants collapsed to 3 canonical keys (opus-4, sonnet-4, haiku-4) via shared `normalizeModel()`

### Agent Teams (hooks)

- **Agent-start fixes** — correct type inference order (dev before test), rawAgentName hoisting, team config fallback for card+persona extraction
- **Queue matching** — name-based pop instead of greedy any-pop; prevents cross-matching parallel spawns
- **Zombie prevention** — checks agent completedAt BEFORE reactivation PATCH; agents completed within 60s are suppressed
- **FK constraint resilience** — retries agent registration without cardId/personaId if FK constraint fails
- **Late registration** — agent-stop registers agents when SubagentStart didn't fire (architect and other read-only types)
- **Team cleanup** — mandatory procedure to complete dashboard agents before TeamDelete; session-start cleans stale team directories
- **Hook timeout** — increased from 5s to 10s for SubagentStart to handle parallel spawns

### Packs

- **Pack persona seeds** — all 8 packs now include `personas` array with relevant Viking-named personas
- **New pack: languages** — Python, .NET, Mobile, AI/ML persona coverage
- **Pack install** — personas sourced from packs use `source='pack'` for three-tier priority

### Dashboard

- **Compliance heatmap** — dual score rows (reviewer primary, self dimmed), ReviewType badges with tooltips
- **Agents tab** — shows agent detail and cardId columns
- **Persona page** — persona agents list, learned skills, data-driven radar chart, persona builder integration
- **Progress bar** — normalized to SCORE_SCALE constant

### Framework

- **Structured interview** — 5 sections with mandatory persona discovery
- **System instructions** — updated thresholds to 1-10, blind reviewer flow, team cleanup procedure
- **Quality rubric** — 1-10 rubric with correctness dimension, blind reviewer documentation, 6-step build gate
- **Agent registry** — fixed duplicate `developer` key (renamed to `developer-subagent`)

### Migrations

- `012` — Scale quality scores x2 (1-5 to 1-10)
- `013` — Normalize agent model names
- `014` — Add correctness + review_type columns
- `015` — Allow multiple quality scores per card (UNIQUE on cardId + review_type)

### Documentation

- **GitHub Wiki** — 10 pages: Home, Getting Started, How It Works, The Dashboard, Personas, Packs, Quality System, Agent Types, Configuration, FAQ
- **README** — updated for v5: persona roster table, blind reviewer, three-tier discovery, wiki links

### Housekeeping

- Removed unverified timeline page (will rebuild properly later)
- `extractStackTags` expanded from bracket-only to 70+ known tech keywords
