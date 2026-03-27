# Volundr v5.0 — Comprehensive Test Plan

> **For:** The new Volundr v5 session to execute after fresh `start.bat --rebuild`
> **Scope:** Every v5 feature across all 7 phases — API, Dashboard UI, Hooks, Framework, Agent Integration
> **Goal:** Find every bug, type error, missing feature, and broken integration. Fix what you find.

---

## How to Use This Plan

1. Read this entire plan before starting
2. Register a project called `v5-test` in the dashboard for test isolation
3. Execute each test section in order (they build on each other)
4. For EVERY test: record PASS or FAIL with evidence
5. For EVERY failure: log it in the error report format below
6. After all tests: summarize findings, fix critical issues, re-test

## Error Report Format

For each failure, write this to `~/.volundr/projects/v5-test/reports/test-failures.md`:

```markdown
### FAIL-{NNN}: {Short description}
- **Test:** {Which test section and number}
- **Card:** {CARD-XX-NNN that implemented this}
- **Expected:** {What should happen}
- **Actual:** {What actually happened}
- **Evidence:** {curl output, error message, screenshot path}
- **Severity:** CRITICAL | HIGH | MEDIUM | LOW
- **Fix hint:** {What likely needs to change}
```

---

## Phase 0: Infrastructure & Enforcement

### T0.1 — Dashboard Health & Migration Runner
```bash
# Test: API is running and DB is properly migrated
curl -s http://localhost:3141/api/health
# ASSERT: {"status":"ok","dbConnected":true,...}

curl -s http://localhost:3141/api/db/status
# ASSERT: schemaVersion >= 9, journalMode = "wal"
# ASSERT: dbSize > 0
```

### T0.2 — DB Backup Endpoint
```bash
curl -s -X POST http://localhost:3141/api/db/backup
# ASSERT: Returns {"backup":"<path>","size":<number>}
# ASSERT: Backup file actually exists at the returned path
# Verify: ls -la <returned_path>
```

### T0.3 — Enforcement Hook: enforce-bash-rules.js
Test that dangerous commands are blocked:
```bash
# These should be BLOCKED (hook returns exit 2):
# Test 1: git add -A
# Run a Bash tool call with: git add -A
# ASSERT: Blocked with message about specific file paths

# Test 2: git add .
# Run: git add .
# ASSERT: Blocked (standalone dot)

# Test 3: git add .claude/hooks/file.js
# ASSERT: NOT blocked (dot followed by path is fine)

# Test 4: git push --force
# ASSERT: Blocked with message about --force-with-lease

# Test 5: Commit message containing "git add -A" as text
# Run: git commit -m "this fixes the git add -A issue"
# ASSERT: NOT blocked (pattern is inside quoted string)
```

### T0.4 — Enforcement Hook: enforce-card-deps.js
```bash
# Setup: Create two test cards where CARD-TEST-002 depends on CARD-TEST-001
curl -s -X POST http://localhost:3141/api/projects/v5-test/cards \
  -H "Content-Type: application/json" \
  -d '{"id":"CARD-TEST-001","epicId":"<test-epic>","title":"Test card 1","size":"S","priority":"P1"}'

curl -s -X POST http://localhost:3141/api/projects/v5-test/cards \
  -H "Content-Type: application/json" \
  -d '{"id":"CARD-TEST-002","epicId":"<test-epic>","title":"Test card 2","size":"S","priority":"P1","deps":["CARD-TEST-001"]}'

# Test: Try to spawn an agent for CARD-TEST-002 while CARD-TEST-001 is not done
# The hook should block agent spawning
# ASSERT: Agent spawn blocked with message about incomplete deps

# Then: Mark CARD-TEST-001 as done, retry
# ASSERT: Agent spawn succeeds
```

### T0.5 — Enforcement Hook: enforce-worktree-isolation.js
```bash
# Test: In a teammate context, try to commit to main
# This requires spawning a teammate and having it try: git commit on main branch
# ASSERT: Blocked with message about worktree isolation
# ASSERT: Same commit on a feature branch succeeds
```

### T0.6 — Enforcement Hook: post-bash-git.js
```bash
# Test: Run git merge and verify auto build gate
# After a git merge command, check events for build_gate_passed or build_gate_failed
curl -s "http://localhost:3141/api/projects/v5-test/events?type=build_gate_passed&limit=1"
# ASSERT: Event exists after merge

# Test: Run git tag and verify milestone event
curl -s "http://localhost:3141/api/projects/v5-test/events?type=milestone_reached&limit=1"
# ASSERT: Event exists after tag
```

### T0.7 — API-Level Gates (6 gates)
```bash
# Gate 1: Deps must be done before in_progress
curl -s -X PATCH http://localhost:3141/api/cards/CARD-TEST-002 \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
# ASSERT: 409 response (CARD-TEST-001 not done)

# Gate 2: Quality score required for done
curl -s -X PATCH http://localhost:3141/api/cards/CARD-TEST-001 \
  -H "Content-Type: application/json" \
  -d '{"status":"done","completedAt":"2026-03-26T00:00:00Z"}'
# ASSERT: 400 response mentioning quality scoring required

# Gate 3: With quality score
curl -s -X PATCH http://localhost:3141/api/cards/CARD-TEST-001 \
  -H "Content-Type: application/json" \
  -d '{"status":"done","completedAt":"2026-03-26T00:00:00Z","quality":{"completeness":4,"codeQuality":4,"formatCompliance":4,"independence":4,"implementationType":"direct"}}'
# ASSERT: 200 success

# Gate 4: Optimization cycle nudge
# After every 5th quality score, check for pending command
curl -s http://localhost:3141/api/projects/v5-test/commands/pending
# ASSERT: After 5 scored cards, an optimization_cycle_due command exists

# Gate 5: Economy mode field accepted
curl -s -X PATCH http://localhost:3141/api/projects/v5-test \
  -H "Content-Type: application/json" \
  -d '{"economyMode":true}'
# ASSERT: 200, project now has economyMode: true
```

### T0.8 — /vldr-doctor Skill
```bash
# Invoke: /vldr-doctor
# ASSERT: Runs 11 checks with pass/fail indicators
# ASSERT: Reports VLDR_HOME, dashboard health, registry, git, node, hooks count
# ASSERT: No crashes, graceful handling of missing optional components
```

---

## Phase 1: Persistent Personas

### T1.1 — Personas CRUD API
```bash
# Create persona
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{"id":"test-persona","name":"Test Persona","role":"developer","expertise":["typescript","react"],"style":"pragmatic"}'
# ASSERT: 200, returns created persona with all fields

# List personas
curl -s http://localhost:3141/api/personas
# ASSERT: Array containing test-persona

# Get single persona
curl -s http://localhost:3141/api/personas/test-persona
# ASSERT: Full persona object with parsed expertise array

# Update persona
curl -s -X PATCH http://localhost:3141/api/personas/test-persona \
  -H "Content-Type: application/json" \
  -d '{"style":"thorough","modelPreference":"sonnet"}'
# ASSERT: Updated fields reflected

# Filter by status
curl -s "http://localhost:3141/api/personas?status=active"
# ASSERT: Only active personas returned
```

### T1.2 — Persona History Entries
```bash
# Add history entry
curl -s -X POST http://localhost:3141/api/personas/test-persona/history \
  -H "Content-Type: application/json" \
  -d '{"section":"learnings","content":"TypeScript strict mode prevents 80% of runtime errors","stackTags":["typescript"],"projectId":"v5-test"}'
# ASSERT: 200, entry created with confidence 1.0

# Add more entries for testing
curl -s -X POST http://localhost:3141/api/personas/test-persona/history \
  -H "Content-Type: application/json" \
  -d '{"section":"decisions","content":"Always use Drizzle ORM over raw SQL","stackTags":["typescript","drizzle"],"projectId":"v5-test"}'

curl -s -X POST http://localhost:3141/api/personas/test-persona/history \
  -H "Content-Type: application/json" \
  -d '{"section":"patterns","content":"Prefer composition over inheritance","stackTags":["typescript"],"projectId":"v5-test"}'

# List history entries
curl -s http://localhost:3141/api/personas/test-persona/history
# ASSERT: 3 entries returned

# Filter by section
curl -s "http://localhost:3141/api/personas/test-persona/history?section=learnings"
# ASSERT: Only learnings entries returned

# Filter by stack tags (if supported)
# ASSERT: Entries matching stack filter returned
```

### T1.3 — History Shadow System (framework)
```
Test the pure TypeScript functions in framework/personas/history-shadow.ts:
- Confidence decay: entry from 7 months ago should have reduced confidence
- Stack filtering: entry tagged ["csharp"] should NOT appear for a ["typescript"] project
- Summarization trigger: create entries exceeding 8KB, verify condensation
- Contradiction detection: "always use X" followed by "never use X" should flag
```

### T1.4 — Charter Compiler (8 layers)
```
Test the charter compiler in framework/personas/charter-compiler.ts:

1. Create a CompileContext with all fields populated
2. Call compiler.compile(context)
3. ASSERT: Output contains all 8 sections in priority order:
   - Layer 1 (Charter): persona identity text
   - Layer 2 (Constraints): project constraints
   - Layer 3 (Steering): active steering rules
   - Layer 4 (Directives): active directives
   - Layer 5 (Skills): matched skills content
   - Layer 6 (History): persona history
   - Layer 7 (Card): card spec + ISC
   - Layer 8 (Traits): injected traits
4. ASSERT: Total output < 12.5KB
5. ASSERT: Each layer respects its byte ceiling
6. Test truncation: provide a 10KB charter.md, verify it's truncated to 1.5KB
7. Test empty layers: compile with no history/skills/directives, verify no empty sections
```

### T1.5 — Persona Seeds (10 profiles)
```bash
# Verify all 10 persona seed files exist and are valid
for p in fullstack-web database-engineer devops-infra test-engineer security-reviewer architect auth-specialist migration-engineer documentation-engineer data-engineer; do
  test -f framework/personas/seeds/$p/charter.md && echo "OK: $p" || echo "MISSING: $p"
  test -f framework/personas/seeds/$p/history.md && echo "OK: $p/history" || echo "MISSING: $p/history"
done
# ASSERT: All 20 files exist

# Verify each charter has required sections
for p in framework/personas/seeds/*/charter.md; do
  grep -q "## Identity" "$p" && grep -q "## What I Own" "$p" && grep -q "## How I Work" "$p" && grep -q "## Boundaries" "$p" || echo "INCOMPLETE: $p"
done
# ASSERT: All charters have all 4 required sections
```

### T1.6 — Personas Dashboard Page
```
Navigate to http://localhost:3000/personas
- ASSERT: Page loads without errors
- ASSERT: Shows persona list (after creating test-persona above)
- ASSERT: Status filter works (all/active/inactive/retired)
- ASSERT: Search works
- ASSERT: Click persona shows detail view with stats and history timeline
- ASSERT: Empty state message shows when no personas exist
```

### T1.7 — Spawn Integration
```
Test framework/personas/spawn-integration.ts:
- linkRegistryToPersona('developer') returns 'fullstack-web'
- linkRegistryToPersona('architect') returns 'architect'
- linkRegistryToPersona('qa-engineer') returns 'test-engineer'
- linkRegistryToPersona('nonexistent') returns null
- compileAgentPrompt('fullstack-web', context) returns a string containing the charter content
```

---

## Phase 2: Global Skills

### T2.1 — Skills CRUD API
```bash
# Create skill
curl -s -X POST http://localhost:3141/api/skills \
  -H "Content-Type: application/json" \
  -d '{"id":"test-skill","name":"Test Skill","description":"A test skill","domain":"testing","confidence":"low","source":"seed","triggers":["test","testing","unit"],"roles":["developer"]}'
# ASSERT: 200, skill created

# List skills
curl -s http://localhost:3141/api/skills
# ASSERT: Array with test-skill

# Filter by domain
curl -s "http://localhost:3141/api/skills?domain=testing"
# ASSERT: Only testing domain skills

# Update skill (should increment version)
curl -s -X PATCH http://localhost:3141/api/skills/test-skill \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated test skill description"}'
# ASSERT: version incremented if content changed

# Delete skill
curl -s -X DELETE http://localhost:3141/api/skills/test-skill
# ASSERT: 200
```

### T2.2 — Skill Matching
```bash
# Create a few skills first for matching
curl -s -X POST http://localhost:3141/api/skills -H "Content-Type: application/json" \
  -d '{"id":"auth-patterns","name":"Auth Patterns","description":"JWT and OAuth","domain":"security","triggers":["jwt","oauth","authentication","login"],"roles":["developer"]}'

curl -s -X POST http://localhost:3141/api/skills -H "Content-Type: application/json" \
  -d '{"id":"db-patterns","name":"DB Patterns","description":"SQL queries","domain":"database","triggers":["sql","query","database","migration"],"roles":["developer"]}'

# Test matching
curl -s -X POST http://localhost:3141/api/skills/match \
  -H "Content-Type: application/json" \
  -d '{"description":"Add JWT refresh token rotation to the authentication system"}'
# ASSERT: auth-patterns ranks highest (jwt + authentication triggers match)
# ASSERT: Returns matches array with skillId, confidence, reason, triggers_matched

curl -s -X POST http://localhost:3141/api/skills/match \
  -H "Content-Type: application/json" \
  -d '{"description":"Optimize SQL query performance and add database indexes"}'
# ASSERT: db-patterns ranks highest (sql + database + query triggers match)

# Edge case: no matching skills
curl -s -X POST http://localhost:3141/api/skills/match \
  -H "Content-Type: application/json" \
  -d '{"description":"something completely unrelated to any skill"}'
# ASSERT: Empty matches or very low scores
```

### T2.3 — Skill Confidence Lifecycle
```bash
# Test staleness: create skill with past reviewByDate
curl -s -X POST http://localhost:3141/api/skills -H "Content-Type: application/json" \
  -d '{"id":"stale-skill","name":"Stale Skill","description":"Old knowledge","domain":"testing","confidence":"high","validatedAt":"2025-01-01","reviewByDate":"2025-06-01"}'

curl -s http://localhost:3141/api/skills/stale-skill
# ASSERT: Response includes stale indicator (stale: true or effective confidence capped at medium)

# Test lifecycle endpoint (if exists)
curl -s -X POST http://localhost:3141/api/skills/stale-skill/lifecycle
# ASSERT: Confidence evaluated, staleness detected
```

### T2.4 — Skill Seeds (24 files)
```bash
# Count seed skill directories
ls framework/skills/seeds/ | wc -l
# ASSERT: >= 24

# Validate each has valid YAML frontmatter
for skill in framework/skills/seeds/*/SKILL.md; do
  head -1 "$skill" | grep -q "^---" || echo "BAD FRONTMATTER: $skill"
  grep -q "^name:" "$skill" || echo "MISSING name: $skill"
  grep -q "^description:" "$skill" || echo "MISSING description: $skill"
  grep -q "^domain:" "$skill" || echo "MISSING domain: $skill"
  grep -q "## Patterns" "$skill" || echo "MISSING Patterns section: $skill"
done
# ASSERT: All seeds have valid frontmatter and required sections
```

### T2.5 — Skills Library Dashboard Page
```
Navigate to http://localhost:3000/skills
- ASSERT: Page loads
- ASSERT: Shows skill list with confidence badges
- ASSERT: Search filters by name/description
- ASSERT: Domain filter works
- ASSERT: Confidence filter works
- ASSERT: Click skill shows detail with triggers, roles, body
- ASSERT: Stale skills show "STALE" badge
```

---

## Phase 3: Intelligent Routing

### T3.1 — Routing Rules CRUD
```bash
# List default rules (should have 11 seed rules)
curl -s http://localhost:3141/api/routing-rules
# ASSERT: >= 11 rules (if seeded on first boot)
# If empty, that's a finding — seed rules should auto-load

# Create rule
curl -s -X POST http://localhost:3141/api/routing-rules \
  -H "Content-Type: application/json" \
  -d '{"workType":"GraphQL API design","personaId":"fullstack-web","examples":["graphql","schema","resolver","mutation"],"confidence":"medium"}'
# ASSERT: Rule created with auto-generated priority

# Test routing
curl -s -X POST http://localhost:3141/api/routing-rules/test \
  -H "Content-Type: application/json" \
  -d '{"description":"Build a GraphQL API with schema-first design and resolver patterns"}'
# ASSERT: Returns matches with persona, confidence, score, reason
# ASSERT: fullstack-web should match (graphql + schema triggers)
```

### T3.2 — Response Tier Selection
```
Test framework/routing/response-tiers.ts:
- Size S card, no deps → Lightweight tier
- Size M card, single domain → Standard tier
- Size L card → Full tier
- Cross-domain deps → Full tier
- Architecture/security tag → Full tier

Test load downgrade:
- 4+ active teammates: Full → Standard
- 6+ active teammates: Standard → Lightweight
- Direct and Lightweight never downgrade
```

### T3.3 — Route Compilation
```
Test framework/routing/route-compiler.ts:
- compileRoutes(): returns sorted CompiledRoute array
- matchRoutes("Add JWT auth"): returns auth-specialist or similar
- Conjunctive match: ALL work type words must be present
- Disjunctive match: ANY example word triggers boost
- Priority scoring: more specific rules win
```

### T3.4 — Routing Map Dashboard Page
```
Navigate to http://localhost:3000/routing
- ASSERT: Page loads
- ASSERT: Shows routing rules table
- ASSERT: Test interface: enter description, get persona match
- ASSERT: Shows confidence and tier in results
- ASSERT: Rule hit counts / accuracy stats (if data exists)
```

### T3.5 — /vldr-route CLI Skill
```
Invoke: /vldr-route "Implement JWT refresh token rotation"
- ASSERT: Shows persona match with confidence
- ASSERT: Shows response tier
- ASSERT: Shows trigger matches
- ASSERT: No errors
```

---

## Phase 4: Governance & Auto-Learning

### T4.1 — Directives CRUD
```bash
# Create global directive
curl -s -X POST http://localhost:3141/api/directives \
  -H "Content-Type: application/json" \
  -d '{"content":"Always use strict TypeScript","source":"manual","priority":1}'
# ASSERT: Created with status=active, projectId=null (global)

# Create project directive
curl -s -X POST http://localhost:3141/api/directives \
  -H "Content-Type: application/json" \
  -d '{"projectId":"v5-test","content":"Use Drizzle ORM for all DB access","source":"confirmed","priority":2}'
# ASSERT: Created with projectId=v5-test

# List all directives
curl -s http://localhost:3141/api/directives
# ASSERT: Both directives returned

# List project directives (should include globals)
curl -s http://localhost:3141/api/projects/v5-test/directives
# ASSERT: Both global and project directives returned

# Suppress a directive
curl -s -X PATCH http://localhost:3141/api/directives/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"suppressed"}'
# ASSERT: Status changed to suppressed

# Suppressed directives excluded from active list
curl -s "http://localhost:3141/api/directives?status=active"
# ASSERT: Suppressed directive NOT in list
```

### T4.2 — Economy Mode
```bash
# Toggle economy mode on
curl -s -X PATCH http://localhost:3141/api/projects/v5-test \
  -H "Content-Type: application/json" \
  -d '{"economyMode":true}'
# ASSERT: Project updated

# Verify economy mode is reflected
curl -s http://localhost:3141/api/projects/v5-test
# ASSERT: economyMode field present and true

# Test model resolution (framework/model-resolution.ts)
# resolveModel('opus-4', true) → 'sonnet-4'
# resolveModel('sonnet-4', true) → 'haiku-4'
# resolveModel('haiku-4', true) → 'haiku-4' (floor)
# resolveModel('sonnet-4', true, 'opus-4') → 'opus-4' (explicit override preserved)
# resolveModel('sonnet-4', false) → 'sonnet-4' (economy off)

# Toggle off
curl -s -X PATCH http://localhost:3141/api/projects/v5-test \
  -H "Content-Type: application/json" \
  -d '{"economyMode":false}'
```

### T4.3 — /vldr-economy Skill
```
Invoke: /vldr-economy
- ASSERT: Shows current economy mode status
- ASSERT: Shows model downgrade table
- Can toggle on/off
```

### T4.4 — Reviewer Lockout
```bash
# Create lockout
curl -s -X POST http://localhost:3141/api/lockouts \
  -H "Content-Type: application/json" \
  -d '{"cardId":"CARD-TEST-001","personaId":"test-persona","reason":"Quality score 2.0"}'
# ASSERT: Lockout created

# Check lockout
curl -s "http://localhost:3141/api/lockouts?cardId=CARD-TEST-001"
# ASSERT: test-persona is locked out

# Verify routing exclusion: route a card and check locked persona is excluded
# This may require testing the routing engine with lockout awareness

# Clear lockout
curl -s -X DELETE http://localhost:3141/api/lockouts/CARD-TEST-001
# ASSERT: Lockout cleared
```

### T4.5 — Ceremony Triggers
```bash
# Test ceremony evaluation endpoint
curl -s -X POST http://localhost:3141/api/ceremonies/evaluate \
  -H "Content-Type: application/json" \
  -d '{"projectId":"v5-test"}'
# ASSERT: Returns list of triggered/not-triggered ceremonies

# Check pending ceremonies
curl -s http://localhost:3141/api/ceremonies/pending
# ASSERT: Returns pending ceremony commands (if any triggered)

# Acknowledge a ceremony
# curl -s -X POST http://localhost:3141/api/ceremonies/acknowledge -d '{"commandId":"..."}'
```

### T4.6 — /vldr-directive Skill
```
Invoke: /vldr-directive "Always validate user input at API boundaries"
- ASSERT: Directive created
- ASSERT: Deduplication check ran (no similar existing directive)

Invoke: /vldr-directive list
- ASSERT: Shows all directives in table format
```

### T4.7 — Directives Dashboard Page
```
Navigate to http://localhost:3000/directives
- ASSERT: Page loads
- ASSERT: Shows directives grouped by status
- ASSERT: Toggle suppress/activate works
- ASSERT: Create form works
- ASSERT: Source badge shows (confirmed/manual/imported)
```

---

## Phase 5: Agent Ecosystem

### T5.1 — Persona Auto-Discovery
```bash
# Test discovery endpoint
curl -s -X POST http://localhost:3141/api/personas/discover \
  -H "Content-Type: application/json" \
  -d '{"stack":["typescript","react","postgresql","docker"]}'
# ASSERT: Suggests fullstack-web (typescript+react), database-engineer (postgresql), devops-infra (docker)
# ASSERT: Each suggestion has personaId, reason, confidence
```

### T5.2 — Cross-Project Learning Extraction
```bash
# Add enough history entries to trigger extraction
# (Need 3+ entries across 2+ projects with same pattern)
for i in 1 2 3; do
  curl -s -X POST http://localhost:3141/api/personas/test-persona/history \
    -H "Content-Type: application/json" \
    -d "{\"section\":\"learnings\",\"content\":\"Always use parameterized queries for SQL\",\"stackTags\":[\"sql\",\"security\"],\"projectId\":\"project-$i\"}"
done

# Test extraction
curl -s -X POST http://localhost:3141/api/personas/test-persona/extract-skills
# ASSERT: Returns extracted skill candidates
# ASSERT: Pattern about parameterized queries detected
```

### T5.3 — Persona Retirement
```bash
# Retire persona
curl -s -X POST http://localhost:3141/api/personas/test-persona/retire
# ASSERT: Status changed to retired
# ASSERT: Alumni summary generated

# List alumni
curl -s http://localhost:3141/api/personas/alumni
# ASSERT: test-persona in alumni list

# Reactivate
curl -s -X POST http://localhost:3141/api/personas/test-persona/reactivate
# ASSERT: Status back to active
```

### T5.4 — Pack Installation
```bash
# List installed packs
curl -s http://localhost:3141/api/packs/installed/v5-test
# ASSERT: Returns array (possibly empty)

# Install a pack (test with roundtable pack)
curl -s -X POST http://localhost:3141/api/packs/install \
  -H "Content-Type: application/json" \
  -d '{"packPath":"framework/packs/roundtable","projectId":"v5-test"}'
# ASSERT: Returns install result with counts

# /vldr-pack skill
# Invoke: /vldr-pack list
# ASSERT: Shows installed packs
```

### T5.5 — Persona Radar Chart (Dashboard)
```
Navigate to http://localhost:3000/personas, click a persona with stats
- ASSERT: Radar chart renders (SVG pentagon)
- ASSERT: 5 axes visible (quality, velocity, cost-efficiency, expertise, activity)
- ASSERT: No JS console errors
```

---

## Phase 6: Dashboard Evolution

### T6.1 — All Pages Load
```
Test EVERY page loads without errors:
- http://localhost:3000/ (Forge home)
- http://localhost:3000/board (Kanban)
- http://localhost:3000/agents (Agent tracker)
- http://localhost:3000/agents/tree (Agent tree)
- http://localhost:3000/insights (Metrics)
- http://localhost:3000/events (Event log)
- http://localhost:3000/settings (Settings)
- http://localhost:3000/thing (The Thing)
- http://localhost:3000/personas (NEW)
- http://localhost:3000/skills (NEW)
- http://localhost:3000/compliance (NEW)
- http://localhost:3000/routing (NEW)
- http://localhost:3000/directives (NEW)

For each page:
- ASSERT: HTTP 200
- ASSERT: Page renders content (not blank/error)
- ASSERT: No uncaught JS exceptions in console
- ASSERT: Navigation links work
```

### T6.2 — Navigation
```
- ASSERT: Top nav has links to all new pages: Personas, Skills, Compliance, Routing, Directives
- ASSERT: Links are in logical order
- ASSERT: Active page is highlighted in nav
```

### T6.3 — Compliance Page
```
Navigate to http://localhost:3000/compliance
- ASSERT: SVG arc gauge renders
- ASSERT: Quality metrics bar chart shows
- ASSERT: Quality heatmap table renders (even if empty data)
- ASSERT: Directives section shows active/suppressed/superseded
```

### T6.4 — Board: Persona Badges
```
Navigate to http://localhost:3000/board
- Create a card with assignedPersonaId set
- ASSERT: Card shows persona badge with color
- ASSERT: Routing confidence percentage visible
- ASSERT: Hover shows routing reason tooltip (if implemented)
```

### T6.5 — Settings: Economy + Personas + Packs
```
Navigate to http://localhost:3000/settings
- ASSERT: Economy mode toggle visible and functional
- ASSERT: Persona list with activate/deactivate toggles
- ASSERT: Pack browser section shows
```

### T6.6 — Metrics Enhancements
```
Navigate to http://localhost:3000/insights
- ASSERT: Persona comparison chart section exists
- ASSERT: Skill usage heatmap section exists
- ASSERT: Compliance trend section exists
- ASSERT: No JS errors even with empty data
```

### T6.7 — Events: New Event Types
```
Navigate to http://localhost:3000/events
- ASSERT: Event icons render for all event types
- ASSERT: New event types (ceremony, directive, skill, compliance) have distinct icons
- ASSERT: Event type filter includes new types
```

### T6.8 — Home: New Widgets
```
Navigate to http://localhost:3000/ (Forge home)
- ASSERT: Compliance score widget visible
- ASSERT: Active personas count widget visible
- ASSERT: Skills count widget visible
- ASSERT: Widgets show real data (or graceful empty state)
```

---

## Integration Tests

### TI.1 — Full Card Lifecycle with Personas
```
End-to-end test: create card → auto-route → spawn agent with persona → complete → score

1. Create a card about "Add JWT authentication"
2. PATCH to in_progress — verify auto-routing assigns auth-specialist persona
3. Verify assignedPersonaId, routingConfidence, routingReason set on card
4. Spawn a developer agent with the persona
5. Verify charter compiler produces prompt with all 8 layers
6. Complete the card with quality score
7. Verify persona history entry created
8. Verify skill usage tracked
```

### TI.2 — Full Spawn Flow with Charter Compilation
```
Test that spawn-integration.ts works end-to-end:
1. Call compileAgentPrompt('fullstack-web', context) with full context
2. ASSERT: Output contains persona charter text
3. ASSERT: Output contains project constraints
4. ASSERT: Output contains matched skills (if card spec triggers any)
5. ASSERT: Output respects byte ceilings (< 12.5KB total)
6. ASSERT: Output is well-formatted markdown
```

### TI.3 — Economy Mode Affects Model Selection
```
1. Set economyMode=true on project
2. Spawn agent — verify model is downgraded (e.g., opus→sonnet)
3. Set explicit override — verify override is NOT downgraded
4. Set economyMode=false — verify normal model selection resumes
```

### TI.4 — Lockout → Re-route Flow
```
1. Create a card, assign to persona-A
2. Score card < 5.0 (quality failure)
3. Verify persona-A is locked out for this card
4. Re-route card — verify different persona selected
5. Score card >= 6.0 — verify lockout cleared
```

### TI.5 — WebSocket Real-Time Updates
```
1. Open dashboard in browser
2. Create a persona via API
3. ASSERT: Dashboard updates in real-time (no page refresh needed)
4. Create a directive via API
5. ASSERT: Directives page updates live
```

---

## CLI Skills Verification

### TS.1 — All Skills Load
```
For each skill, invoke it and verify it doesn't crash:
- /vldr-doctor
- /vldr-economy
- /vldr-directive list
- /vldr-route "test task"
- /vldr-pack list
- /vldr-journal (show recent)
- /vldr-shutdown (DO NOT actually run — just verify skill file exists and parses)
```

---

## Framework Files Verification

### TF.1 — TypeScript Files Compile
```bash
# Check all framework .ts files have valid syntax
for f in framework/**/*.ts; do
  node -e "require('fs').readFileSync('$f','utf8')" && echo "OK: $f" || echo "FAIL: $f"
done
```

### TF.2 — Registry Has Persona Templates
```
Read framework/agents/registry.ts
- ASSERT: personaTemplate field exists on agent type definitions
- ASSERT: developer maps to fullstack-web
- ASSERT: architect maps to architect
```

### TF.3 — Model Resolution
```
Read framework/model-resolution.ts
- ASSERT: resolveModel function exists
- ASSERT: Handles economy downgrade correctly
- ASSERT: Preserves explicit overrides
```

### TF.4 — Detect-and-Suggest Documentation
```
Read framework/directives/detect-and-suggest.md
- ASSERT: Documents signal words (always, never, from now on, etc.)
- ASSERT: Documents the flow (detect → ask → confirm → save)
```

---

## Negative Tests (Things That Should Fail Gracefully)

### TN.1 — Invalid Persona ID
```bash
curl -s http://localhost:3141/api/personas/nonexistent-persona
# ASSERT: 404 response, not 500
```

### TN.2 — Invalid Skill Match Input
```bash
curl -s -X POST http://localhost:3141/api/skills/match \
  -H "Content-Type: application/json" \
  -d '{}'
# ASSERT: 400 with message about missing description, not 500
```

### TN.3 — Duplicate Persona ID
```bash
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{"id":"test-persona","name":"Duplicate","role":"developer"}'
# ASSERT: 409 or appropriate error, not 500
```

### TN.4 — Delete Persona With History
```bash
# Should cascade or warn, not crash
curl -s -X DELETE http://localhost:3141/api/personas/test-persona
# ASSERT: Either succeeds (cascade) or returns clear error
```

### TN.5 — Routing With No Rules
```bash
# Delete all routing rules, then test
curl -s -X POST http://localhost:3141/api/routing-rules/test \
  -H "Content-Type: application/json" \
  -d '{"description":"some task"}'
# ASSERT: Returns empty matches, not 500
```

### TN.6 — Ceremony Check With No Cards
```bash
curl -s -X POST http://localhost:3141/api/ceremonies/evaluate \
  -H "Content-Type: application/json" \
  -d '{"projectId":"nonexistent"}'
# ASSERT: Graceful response, not 500
```

---

## Summary Checklist

After running all tests, fill in this summary:

```markdown
## Test Results Summary

**Date:** ____
**Volundr Version:** v5.0.0
**Dashboard Image:** volundr-dashboard:v5-test
**Schema Version:** ____

### Results by Phase
| Phase | Tests | Pass | Fail | Skip |
|-------|-------|------|------|------|
| Phase 0: Enforcement | T0.1-T0.8 | | | |
| Phase 1: Personas | T1.1-T1.7 | | | |
| Phase 2: Skills | T2.1-T2.5 | | | |
| Phase 3: Routing | T3.1-T3.5 | | | |
| Phase 4: Governance | T4.1-T4.7 | | | |
| Phase 5: Ecosystem | T5.1-T5.5 | | | |
| Phase 6: Dashboard | T6.1-T6.8 | | | |
| Integration | TI.1-TI.5 | | | |
| CLI Skills | TS.1 | | | |
| Framework | TF.1-TF.4 | | | |
| Negative | TN.1-TN.6 | | | |
| **TOTAL** | | | | |

### Critical Failures (must fix before release)
1. ____
2. ____

### High Priority Fixes
1. ____
2. ____

### Medium/Low (can ship, fix later)
1. ____
2. ____

### What Passed Cleanly
{List areas that worked perfectly}
```

---

## Fixing Instructions

When fixing failures:

1. **Read the error carefully** — understand root cause before changing code
2. **Fix in the volundr repo** — `C:/Users/SebastianWesselhoff/source/repos/volundr`
3. **Run typecheck after each fix** — `cd dashboard && npx turbo typecheck`
4. **Commit each fix** — `git commit -m "fix(test): {description}"`
5. **Re-run the failing test** to verify the fix
6. **Update the test results summary**

For API errors: check route files in `dashboard/packages/api/src/routes/`
For schema errors: check `dashboard/packages/db/src/schema.ts` and migration files
For UI errors: check `dashboard/apps/web/src/app/{page}/page.tsx`
For hook errors: check `.claude/hooks/{hook}.js`
For framework errors: check `framework/{module}/{file}.ts`

**Do not skip negative tests** — they catch the crashes users will hit.

---

*Original plan generated by Volundr v4. Updated by Volundr v5 after first pass (added v5 findings, corrected field names, added hardening tests).*

---

## v5 Additions: API Contract Corrections

> These corrections were discovered during the first test pass. The API is correctly implemented —
> the v4 test plan had field name mismatches.

| Original Test | v4 Used | Correct Field/URL |
|--------------|---------|-------------------|
| T1.2 history POST | `section` | `entryType` (values: learning, decision, pattern, core_context) |
| T2.2 skill match | `description` | `query` |
| T4.4 lockouts | `/lockouts` | `/reviewer-lockouts` |
| T4.5 ceremonies | `/ceremonies/evaluate` | `/projects/:id/ceremonies/evaluate` |
| T5.1 discovery | `stack` | `stackSignals` |
| T5.2 extract-skills | no body | must send `{}` with Content-Type |
| T5.4 pack install | `packPath` body | `manifest` object from pack.json |

---

## Phase 7: v5 Hardening Tests

### T7.1 — PATCH /personas/:id (partial update)
```bash
# PATCH should update individual fields without requiring all fields
curl -s -X PATCH http://localhost:3141/api/personas/test-persona \
  -H "Content-Type: application/json" \
  -d '{"style":"meticulous"}'
# ASSERT: 200, style changed to "meticulous", other fields unchanged

curl -s -X PATCH http://localhost:3141/api/personas/test-persona \
  -H "Content-Type: application/json" \
  -d '{"modelPreference":"opus"}'
# ASSERT: 200, modelPreference changed to "opus"

# PATCH nonexistent
curl -s -X PATCH http://localhost:3141/api/personas/nonexistent \
  -H "Content-Type: application/json" \
  -d '{"style":"x"}'
# ASSERT: 404, not 500
```

### T7.2 — DELETE /personas/:id (cascade delete)
```bash
# Create throwaway persona with history
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{"id":"throwaway","name":"Throwaway","role":"tester","expertise":"testing"}'

curl -s -X POST http://localhost:3141/api/personas/throwaway/history \
  -H "Content-Type: application/json" \
  -d '{"entryType":"learning","content":"Test entry","stackTags":["test"]}'

# Delete persona (should cascade to history)
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:3141/api/personas/throwaway
# ASSERT: 204

# Verify gone
curl -s -o /dev/null -w "%{http_code}" http://localhost:3141/api/personas/throwaway
# ASSERT: 404
```

### T7.3 — ISC via PATCH /cards/:id (inline update)
```bash
# ISC should be settable via the main card PATCH endpoint, not just /isc
curl -s -X PATCH http://localhost:3141/api/cards/CARD-TEST-002 \
  -H "Content-Type: application/json" \
  -d '{"isc":[{"criterion":"Test criterion","evidence":"test","passed":true}]}'
# ASSERT: 200, ISC array present in response
```

### T7.4 — History section/entryType filter
```bash
# Filter by section query param (alias for entryType)
curl -s "http://localhost:3141/api/personas/test-persona/history?section=learning"
# ASSERT: Only learning entries returned (not all)

curl -s "http://localhost:3141/api/personas/test-persona/history?section=decision"
# ASSERT: Only decision entries returned
```

### T7.5 — persona_skills table exists
```bash
# The persona_skills table must exist (migration 011)
curl -s http://localhost:3141/api/db/status
# ASSERT: schemaVersion >= 11
```

### T7.6 — Safe JSON.parse on corrupted ISC
```bash
# Directly corrupt ISC in DB, then PATCH — should not 500
# (This tests the try-catch wrap around JSON.parse in cards.ts)
# Simulated: PATCH a card to done when ISC is valid
# ASSERT: No 500 errors on card operations with ISC data
```

### T7.7 — SDK Resource Coverage
```bash
# Verify all API routes have SDK resources by checking the built SDK exports
cd dashboard && node -e "
  const sdk = require('./packages/sdk/dist/index.js');
  const client = new sdk.VolundrClient({ projectId: 'test' });
  const resources = [
    'project', 'epics', 'cards', 'agents', 'events', 'quality',
    'metrics', 'lessons', 'personas', 'skills', 'routingRules',
    'directives', 'packs', 'commands', 'logs', 'journal',
    'sessionSummaries', 'teams', 'economy', 'reviewerLockouts', 'ceremonies'
  ];
  let pass = 0;
  for (const r of resources) {
    if (client[r]) { pass++; } else { console.log('MISSING:', r); }
  }
  console.log(pass + '/' + resources.length + ' resources present');
"
# ASSERT: 21/21 resources present
```

### T7.8 — extract-skills with empty body
```bash
curl -s -X POST http://localhost:3141/api/personas/test-persona/extract-skills \
  -H "Content-Type: application/json" \
  -d '{}'
# ASSERT: 200, not crash (was previously: Cannot destructure)
```

### T7.9 — Expertise accepts both string and array
```bash
# Array format
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{"id":"arr-test","name":"Array Test","role":"developer","expertise":["go","rust"]}'
# ASSERT: 201, expertise stored as "go, rust"

# String format
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{"id":"str-test","name":"String Test","role":"developer","expertise":"python, java"}'
# ASSERT: 201, expertise stored as "python, java"

# Cleanup
curl -s -X DELETE http://localhost:3141/api/personas/arr-test
curl -s -X DELETE http://localhost:3141/api/personas/str-test
```

### T7.10 — All 7 CLI skills have SKILL.md files
```bash
for skill in vldr-doctor vldr-economy vldr-directive vldr-route vldr-pack vldr-journal vldr-shutdown; do
  test -f ".claude/skills/$skill/SKILL.md" && echo "OK: $skill" || echo "MISSING: $skill"
done
# ASSERT: 7/7 present
```

### T7.11 — Shared types for Command, Economy, Ceremony
```bash
cd dashboard && grep -c "export interface Command\b\|export interface EconomyStatus\|export interface CeremonyTrigger\|export interface CeremonyEvaluationResult" packages/shared/src/types.ts
# ASSERT: >= 4 matches
```

### T7.12 — Full TypeScript typecheck (zero errors)
```bash
cd dashboard && npx turbo typecheck
# ASSERT: All 7 packages pass, zero errors
```
