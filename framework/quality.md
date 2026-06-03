# Agent Quality & Self-Optimization System

## Scoring Rubric (1-10)

| Dimension | Weight | 1-2 | 5-6 | 9-10 |
|-----------|--------|-----|-----|------|
| Completeness | 3x | Missing most | All files, some gaps | Every criterion met |
| Code Quality | 3x | Broken, no types | Works, reasonable | Clean, idiomatic |
| Format Compliance | 2x | Ignored format | Mostly followed | Perfect |
| Correctness | 2x | Logic broken | Works, some edge cases | Handles all cases |

Score = (C×3 + Q×3 + F×2 + R×2) / 10

## Review Types

Every card gets TWO scores:
1. **Self-score** (`reviewType: "self"`) — implementer's self-assessment, logged as supplementary
2. **Reviewer score** (`reviewType: "reviewer"`) — blind reviewer agent, this is the OFFICIAL score

The quality gate checks the reviewer score. If no reviewer score exists, falls back to self-score.

A **blind reviewer agent** (read-only, Haiku model) is spawned after each card completes:
- Reads: card spec, ISC criteria, git diff, changed file contents
- Never sees the developer's self-score
- Scores each ISC criterion as pass/fail with evidence
- Scores the 4 dimensions independently
- Reviewer score is the official quality score

## Thresholds
| Score | Rating | Action |
|-------|--------|--------|
| 9.0+ | Excellent | Flag as reference |
| 7.0+ | Good | Accept, note improvements |
| 5.0+ | Needs Work | Fix issues, optimize for next time |
| <5.0 | Poor | Fix immediately |

## Self-Scoring
When Volundr implements directly, self-score with tag `direct`.
This keeps the quality log meaningful even without external agents.

## Optimization Cycle (every 5 cards)
1. Analyze quality trends via `vldr.metrics.get()` (qualityTrend, averageQualityScore)
2. Identify patterns (low-scoring card types, problematic domains)
3. Log insights via `vldr.lessons.create({ title, content, stack })`
4. Adjust SubOrchestrator prompts for next batch

## Retry (for Agent tool sub-agents)
- Level 1: Add failure analysis to prompt
- Level 2: Full prompt rewrite with examples
- Level 3: Escalate to developer

---

## Build Gate (MANDATORY - per agent AND per card)

**Run after EVERY agent completes, not just at card boundaries.**

In the CrowdTwist project, errors compounded when build gates were only run after batches. Running `tsc --noEmit` after each individual agent caught errors at 14 total across 4 check runs. Catching them immediately is cheaper than fixing them later.

### 1. Type Check (after every agent)
```bash
npx tsc --noEmit
```
Must exit 0. If it fails, fix before merging the agent's output or spawning the next agent.

### 2. Production Build (after every agent that touches UI/frontend files)
```bash
# For Next.js projects (e.g., the dashboard)
npx next build

# For Vite projects
npx vite build
```
Must exit 0. A production build catches runtime import errors, SSR issues, missing assets, and bundle problems that `tsc --noEmit` misses. If the project has no frontend, skip this step.

### 3. Smoke Test (UI cards only, if dev server is running)
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/{affected-route}
```
Must return 200. A 500 means runtime errors the build didn't catch.

### 4. Antipattern Grep (after every agent)
After every agent writes code, grep for known-bad patterns from `constraints.md`:
- Check for all patterns in the Discovered Antipatterns table
- Check for circular CSS variable references: `var(--font-` self-referencing
- Check for `new Date()` in non-client components
- Check for `value={` without `?? ` default
- Check for redefined types that should be imported from shared files
If any match, fix before committing.

### 4a. Operational Affordances (background-pipeline cards only)

**Trigger:** card adds or materially changes any of the following — BackgroundService, IHostedService, Hangfire (job, recurring job, or dashboard mount), SSE endpoint, WebSocket endpoint, long-polling endpoint, System.Threading.Channels pipeline, or a cross-process queue (Service Bus, RabbitMQ, Kafka, etc.).

This list is not exhaustive — the underlying signal is "long-lived async work that fails in non-obvious ways."

When the trigger fires, the card **MUST** append entries to `docs/DEBUGGING.md` covering all six operational concerns below. A card that ships without them **fails this gate**.

| # | Concern | Required content |
|---|---------|-----------------|
| 1 | **Log-line correlation** | Which property is the correlation key; example Serilog/log-filter expression that lets a developer follow one unit of work end-to-end |
| 2 | **Admin/dashboard surface** | URL or CLI command to reach the management UI (Hangfire dashboard, queue console, etc.); auth caveat; port-forward/Docker note |
| 3 | **Persistent state inspection** | SQL/KQL/Redis query recipe for "what's pending right now" and "what's stuck/failed" against the backing store |
| 4 | **Transport observation** | `curl`/`websocat`/equivalent one-liner that proves the wire is delivering (or isn't), with an example payload |
| 5 | **Isolated replay** | How to re-run a single unit of work via a unit/integration test — test filter expression, fixture name, minimal sample data |
| 6 | **Recovery from known-bad state** | Kill an orphan, clear a DLQ, re-enqueue a failed job, force a leadership election, etc. — concrete commands |

See `framework/examples/DEBUGGING.example.md` for a worked end-to-end example.

> **Forward note (UI cards):** Once the FRW-BL-014C2 portal scanner ships, UI cards SHOULD include a `portal` annotation on each ISC criterion that targets a route (`IscCriterion.portal`). This is not a current requirement.

### 4b. Anti-Stub Scan (MANDATORY — before blind review) [FRW-BL-044]

A common agent failure is shipping stubbed/mocked/`NotImplemented`/TODO code that passes `tsc` and shallow checks. Run the deterministic scanner on the card's changed **non-test** files BEFORE spawning the blind reviewer:

```bash
node scripts/anti-stub-scan.mjs --diff main...<card-branch>   # or: --staged, or explicit file paths
```

- **BLOCK** findings (real unfinished-code constructs: `NotImplementedError`/`NotImplementedException`, `raise NotImplementedError`, `throw new Error('not implemented'|...stub...)`, `panic("not implemented")`) → exit 2. The card MUST NOT reach blind review until fixed.
- **WARN** findings (`TODO`/`FIXME`/`stub`/`mock`/`fake`/`placeholder`/prose "not implemented") → printed, non-blocking; the reviewer confirms they're intentional.
- Test files (`*.test.*`, `*.spec.*`, `__tests__/`, `fixtures/`, `spec/`) are excluded — they legitimately contain mocks/stubs.
- BLOCK rules are intentionally tight (code constructs only) so a file that merely *discusses* stubs (e.g. a stub-detector's own strings) is not falsely blocked.

### 5. Card Completion Manifest
Write `projects/{id}/reports/manifest-{CARD-ID}.json` after passing all gates.

### 6. Spotcheck Gate (per parallel round - MANDATORY)

After all teammates idle and before merging branches to main:
1. Reviewer spotcheck runs against all completed branches from this round
2. BLOCK findings are merge blockers - must be fixed first
3. WARN/INFO findings are logged as events
4. Guardian flags missing spotcheck events at milestone review (audit trail)

---

## Verification-Before-Completion Gate (FRW-BL-045)

**Iron law: no completion claim without fresh evidence.** A card MUST NOT transition to
`done`, and no agent may assert "it works / passes / is fixed / is complete", unless a
verification command was run **this session** and its **output + exit code** are captured
as evidence tied to the claim. Use the `vldr-verify` skill to produce the evidence block.

**Definition of Done addition** — for every ISC criterion whose truth depends on runtime
behaviour (build passes, test passes, route returns 200, migration applied, hook blocks/
allows), the criterion's `evidence` MUST contain a fresh `VERIFY` block:

```
VERIFY [<command>]
exit=<code>            # 0 = pass; non-zero FAILS the claim
<relevant output, trimmed to the lines that prove the claim>
ran: <this session>
```

**Rejection rule (enforced at blind review):** a reviewer MUST mark such an ISC criterion
`passed:false` if its evidence has no fresh command + exit-code, or cites stale/assumed
output ("should pass", "compiles", "looks correct"). Compiling is the floor, not proof.

**Exemptions:** pure-documentation / contract / spec criteria that are verifiable by reading
the diff (no runtime behaviour) do not require a `VERIFY` block — but state *what reading
proves them* in the evidence. When in doubt, run the command and attach the block.

**Enforcement points:** `vldr-verify` skill (produces the block) · card DoD (this section) ·
`card-reviewer.md` blind-review rubric (rejects unverified runtime claims) · Guardian and
QA persona prompts (per-card + milestone enforcement).

---

## Garden lint — framework drift + size caps (FRW-BL-067)

`node scripts/garden-lint.mjs` keeps `framework/packs` + `framework/agents/registry.ts` +
prompt/skill templates consistent. It **fails (exit 1)** on:
- **dead cross-references** — a registry `promptTemplate` / `personaTemplate` / `pack` that
  points at a file/seed/pack that doesn't exist (drift between the registry and the tree);
- **bad pack manifests** — a `framework/packs/<name>/pack.json` that won't parse or lacks name/version;
- **size-cap violations** — a prompt template or `SKILL.md` over `MD_BYTE_CAP` (16 KB) bloat guard.

Orphan prompts (templates not referenced by the registry) are reported as **warnings** (non-failing).
It runs in CI as the **`garden`** job (`.github/workflows/ci.yml`) on every push/PR to `main`, and
locally via `node scripts/garden-lint.test.mjs` for the pure cores.

---

## Tiered, Statistically-Confident Quality Gate (FRW-BL-046)

Scoring is tiered so cheap deterministic checks fail fast before the (expensive, noisier) LLM judge,
and high-stakes cards get a confidence-aware verdict instead of a single coin-flip score.

### Tier 0 — static, cheap, deterministic (runs FIRST, before any LLM judge)
Build gate (`tsc` / `node --check` / unit tests), the Anti-Stub Scan (§4b), and an ISC STRUCTURAL
check (every criterion present + non-empty, and — for runtime-verifiable ones — carrying a fresh
VERIFY block per §Verification-Before-Completion). **If Tier 0 fails, do NOT spawn the LLM judge** —
fix first. This saves judge cost on cards that aren't even structurally ready.

### Tier 1 — LLM judge (blind reviewer), confidence-aware for high-stakes cards
- **Normal cards:** one blind reviewer; its weightedScore is the official record (as today).
- **High-stakes cards** (P0, security/auth, load-bearing framework code, or size L/XL): run **N≥3**
  independent judge samples and compute the **mean and spread** of weightedScore.
  - Accept only if `mean ≥ 5.0` AND the spread is tight (e.g. `max − min ≤ 2.0`, or stdev ≤ 1.0).
  - **Reject a high-but-unstable score.** Samples `9, 9, 4` → mean 7.3 but unstable → a flaky high
    score is distrusted: re-review with a sharper rubric, or treat as not-passing. Stability is part
    of the gate, not just the mean. Where failure modes differ, use diverse adversarial lenses for the
    N samples (see the review-changes workflow / dispatching-parallel-agents).

### Anchored rubric (reduce free-form drift)
Score each dimension against EXPLICIT level anchors, not a free-form gut number. The 1-10 dimension
table at the top of this doc is the canonical scale; for each ISC dimension apply the anchored 5-band
reading — **1-2** broken · **3-4** major gaps · **5-6** meets baseline · **7-8** clean/tight ·
**9-10** reference-quality — and cite the band's criteria as the evidence. Anchoring + the N-sample
spread check together attack the "confident but inconsistent" judge failure that the harsh-critic
benchmark targets (calibrated by FRW-BL-047).

Storage is unchanged (1-10 per dimension, `weightedScore = (C·3 + Q·3 + F·2 + R·2)/10`); this section
adds the ORDERING (static-first), the high-stakes N-sample confidence check, and the anchoring discipline.

---

## Contested-Review Quorum Resolution (FRW-BL-064)

When a review verdict is **contested**, resolve by quorum — not a single lead-arbiter override.

**Uncontested (common path, unchanged):** one blind reviewer ≥ 5.0 with no dispute → accept, as
today. A single adversarial pass that CONFIRMS the verdict is also uncontested.

**Contested triggers:**
- An adversarial reviewer REFUTES a blind "pass" (or a blind "fail" is challenged).
- The blind score straddles the gate (≈4.5–5.5) or is high-but-unstable (per FRW-BL-046).
- A Round Table / Chaos Engine round is split with no clear convergence.

**Quorum resolution (contested only):**
1. Run **N≥3 independent reviewers**, preferring DIVERSITY — vary the lens (correctness / security /
   reproduce) and, where possible, the MODEL (a cross-model reviewer, e.g. a Sonnet judge alongside
   Haiku) so failure modes aren't correlated.
2. Resolve by **vote**, not lead fiat:
   - **Majority** — the pass/fail verdict with more than half the votes wins.
   - **Persona-confidence-weighted** — when reviewers report confidence, weight votes by it (a HIGH-
     confidence refutation outweighs two LOW-confidence passes). Ties → treat as NOT-passing
     (fail-safe) and surface to the operator.
3. Volundr records the vote tally + deciding rationale as an event/journal entry and does NOT silently
   override the quorum. If Volundr genuinely disagrees with the quorum outcome, it ESCALATES to the
   operator rather than overriding.

**Unchanged:** the retry ladder, round sequencing, and the single-reviewer path for uncontested cards
are untouched — quorum is an ADDITIVE escalation for the contested minority.
