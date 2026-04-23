# Volundr Framework Improvement Backlog

Living list of framework issues surfaced during real-project runs. Each card
is self-contained and intended to be readable by a "blank" agent with **no
prior session context** - a cold reader should be able to understand, scope,
and ship the fix from the card alone without asking clarifying questions.

**Card format (mandatory):**

- **Issue** — one-line problem statement
- **Severity** — High / Medium / Low
- **Surfaced during** — the project + session that hit it
- **Why** — what specifically went wrong in the observable sequence
- **Description** — full reproduction detail, including tool outputs, paths,
  and commands
- **Solution** — proposed fix with enough specificity to implement
- **Framework files to change** — exact `framework/**` paths that need edits
- **Tests / validation** — how we know the fix works
- **Effort estimate** — rough T-shirt size
- **Dependencies / blockers** — other backlog items or external state

Cards are **additive only**. Do not re-title or renumber without marking
the old id as superseded — links into this file must stay stable.

---

## FRW-BL-001: Dev agent worktree placement is unreliable on cross-repo projects

- **Severity**: **High**
- **Surfaced during**: CLEAR project autonomous run (2026-04-23), ENG-016,
  OPS-004, SCN-002 slice 1 dispatches.

### Why

When Volundr is loaded against a project whose working-directory is NOT
inside the Volundr framework repo itself (the CLEAR case:
`C:\Users\SebastianWesselhoff\source\repos\internal\clear\`), dev agents
spawned with `isolation: "worktree"` sometimes land in the wrong filesystem.
They end up under
`C:\Users\SebastianWesselhoff\source\repos\volundr\.claude\worktrees\agent-<id>\`
(the Volundr framework repo's worktrees directory) instead of the expected
`C:\Users\SebastianWesselhoff\source\repos\internal\clear\.claude\worktrees\<slug>\`
(the project's worktrees directory).

Hit rate observed this session: **3 of 4** dev agents landed in the wrong
place. The ENG-008 Phase-2 agent landed correctly; ENG-016, OPS-004, and
SCN-002-slice-1 all landed in the Volundr repo. (The session's reviewers
and the devops-engineer for OPS-004 used the same mechanism; same flakiness.)

### Description

Observed sequence for ENG-016 dispatch:

1. Parent agent (working directory:
   `C:\Users\SebastianWesselhoff\source\repos\volundr`, active project
   registered as `clear` pointing at `internal/clear`) dispatches a
   `developer` agent with `isolation: "worktree"` to build Chat + Settings
   controllers.
2. Agent's task-notification reports
   `worktreePath: C:\Users\SebastianWesselhoff\source\repos\volundr\.claude\worktrees\agent-ae4fa0ed`.
3. Agent writes all its code into that path — but the path is **empty**
   (the worktree is at the framework repo's worktrees tree, not the CLEAR
   project's).
4. Agent completes its budget, returns `status: completed`, summary ends
   mid-sentence: `"Good pattern. Now let me write the test files. First
   the ChatControllerTests..."` — ships **zero commits** to the CLEAR repo.
5. Manual cleanup: `git worktree remove` on the stale Volundr-side worktree.
6. Had to redo the entire scope from scratch.

Contrast with the ENG-008 Phase-2 dev agent that **did** land correctly:
its worktree landed at
`C:\Users\SebastianWesselhoff\source\repos\internal\clear\.claude\worktrees\clr-eng-008-phase2-remainders\`
and it shipped a clean commit. The framework's own `git worktree list`
inside the CLEAR repo showed only the correctly-placed one.

Commit `8fe769c fix: worktree hook resolves active project path from
registry` (landed before this session) suggests this was a known area; the
fix is either incomplete or has a race condition on first-fire for
newly-dispatched agents.

### Root-cause hypothesis

The hook that resolves the active project's path before `EnterWorktree`
fires reads from `VLDR_HOME/projects/registry.json`. If the agent dispatch
happens from a working directory outside the active project's path (e.g.
the parent agent is cwd'd in the framework repo running the CLEAR
project), and the hook falls back to "use the parent's cwd" on any
registry lookup failure, it will land the worktree in the wrong
filesystem.

**Check**:

- the order of resolution in the worktree hook (registry vs cwd fallback)
- whether the hook is synchronous / idempotent
- whether concurrent dispatches share a cached "last active project" that
  can desync

### Solution

1. **Agent-side sanity check** (defensive, ships fast):
   - After `EnterWorktree` fires, the agent's first action should be a
     `pwd` + `git rev-parse --show-toplevel` — if the toplevel doesn't
     equal the active project's registered path, abort with a clear
     `ERROR: worktree landed in wrong filesystem; expected <X>, got <Y>`
     and exit. No work attempted.
   - The system-instructions prompt for developer / devops-engineer /
     qa-engineer agents should include this check in their opening
     preflight.

2. **Framework-side fix** (proper):
   - Audit the worktree-placement hook's resolver.
   - Make it read from the registry authoritatively — no cwd fallback.
   - If the registry lookup fails, the hook should **block the dispatch**
     with an explicit error rather than silently defaulting.
   - Add logging so operators can see which path the hook resolved to on
     every dispatch.

3. **Cleanup of the tracking-worktree pattern**:
   - The empty `volundr/.claude/worktrees/agent-<id>/` directories that
     get created even for correct dispatches are confusing — they look
     like failed agent work. Either remove them (they serve no purpose
     if the real work is in the project repo) or rename the path to
     something clearly labelled as a tracking stub (e.g.
     `volundr/.claude/agent-sessions/<id>.json`).

### Framework files to change

- `.claude/hooks/worktree-resolver.<js|ts>` (exact filename — grep for
  the hook implementation)
- `framework/system-instructions.md` — add the preflight sanity check to
  the developer / devops / qa teammate opening prompts
- `framework/agents/registry.ts` if the hook reads from here rather than
  the raw registry.json
- `framework/packs/*/prompts/developer.md` — add the preflight to the
  spawned-developer prompt template

### Tests / validation

- **Repro**: spawn a developer agent in worktree isolation from a Volundr
  session targeting a non-Volundr project 10 times; all 10 must land in
  the correct project's worktrees directory.
- **Regression test**: add an integration test to the Volundr repo's CI
  that spawns a dummy agent against a fixture project and asserts the
  worktree path.
- **Manual**: run the original CLEAR push with the fix and confirm no
  tracking worktrees appear in the Volundr repo.

### Effort estimate

**M** — the hook itself is probably 20-40 lines of logic; the audit +
agent-side preflight takes a bit longer because it touches every
teammate prompt.

### Dependencies / blockers

None.

---

## FRW-BL-002: Agent budget exhaustion produces no partial-commit checkpoint

- **Severity**: **High**
- **Surfaced during**: CLEAR autonomous run, agents
  `ae4fa0ed48fa8309b` (ENG-016), `a560a55eeae1ab07d` (SCN-002 s1),
  `afadb2f49ae04e79e` (OPS-004).

### Why

When a sub-agent runs out of token budget mid-implementation, it returns
`status: completed` to the parent with a truncated summary ending
mid-sentence (e.g. `"Now let me write the test files..."` or
`"Now fix the hardcoded vault.azure.net in the placeholder URIs - use..."`).
The parent has **no structural signal** that the work was cut short vs.
genuinely complete. The field `status: completed` is indistinguishable
between "agent finished" and "agent timed out partway through."

Hit rate: ~50% of dev agents this session exhausted budget with
incomplete work; every one returned `completed`.

### Description

Observed pattern across three failures:

**SCN-002 slice 1 (agent `a560a55e`):**
- Agent shipped: models + 3 new GraphApiClient reader methods + scanner
  pre-fetch block (~215 lines across 3 files). **Never committed** to the
  worktree branch. Never wrote the check implementations or tests.
- Summary: `"Now let me implement the three checks in the
  IdentityAccessScanner... Step 3: Update IdentityAccessScanner.cs:
  First, update the ScanAsync pre-fetch block and task list:"`
- Status: `completed`.
- Recovery: parent had to inspect the worktree diff manually, finish the
  3 check methods + 19 tests + commit itself.

**OPS-004 (agent `afadb2f4`):**
- Agent shipped: 8 Bicep modules (~1400 LoC), compiled JSON artefacts,
  committed. Timed out fixing the final 5 lint warnings
  (vault.azure.net hardcoding, listKeys-in-output, minLength floors).
- Summary: `"Now fix the hardcoded vault.azure.net in the placeholder
  URIs - use `az.environment().suffixes.keyvaultDns` or restructure so
  placeholders don't contain the domain:"`
- Status: `completed`.
- Recovery: parent fixed the 5 warnings itself.

**ENG-016 (agent `ae4fa0ed`):**
- See FRW-BL-001 for the worktree-placement failure. Agent wrote code
  into the wrong filesystem then exhausted budget before committing
  anything. Status: `completed`.

### Impact

- Parent agent has to inspect **every** sub-agent's worktree manually,
  even for "completed" dispatches, to check whether work is real or
  stub-and-bail.
- "Run in background" promise is undermined — completion notification
  doesn't mean the work is ready to merge.
- Time cost this session: ~90 minutes of salvage work across 3 agents.

### Solution

**Three layers, additive:**

1. **Agent-side periodic checkpoint** (belts):
   - Every sub-agent with `isolation: "worktree"` must commit `WIP:
     <slug>` every N tool calls or every ~20% of its estimated token
     budget, whichever comes first. Even a half-finished check should be
     on the branch so the parent can `git log` and see how far it got.
   - Enforced in the agent prompt template. An agent that ends without a
     commit has effectively shipped nothing and the framework should
     flag it.

2. **Structured completion state on the return notification** (braces):
   - Add a `completion_state: complete | partial | aborted` field to the
     task notification. Inferred heuristically:
     - `complete` — last 3 tool calls are Bash (build/test passing) +
       Write/Edit + Bash commit. Summary ends on a period.
     - `partial` — last tool call is Write/Edit without a subsequent
       build/test, OR summary ends on `:` / mid-sentence.
     - `aborted` — agent returned with an error before any commit.
   - Parent can branch on this field instead of parsing summary prose.

3. **Parent-side verify step** (trouser):
   - Whenever a worktree-isolated agent returns, the parent must
     automatically run `git log --oneline <worktree-branch> -5` and
     diff-stat against main before trusting the "completed" signal.
     This is cheap and catches both zero-commit exhaustion and partial
     work.
   - Pattern should be codified in the Team Lead's system instructions.

### Framework files to change

- `framework/system-instructions.md` — add the parent-side verify step
  as a mandatory post-dispatch action for background agents
- `framework/packs/*/prompts/developer.md` (and devops / qa / designer
  equivalents) — add the periodic-checkpoint instruction
- `framework/agents/registry.ts` — if the completion-state inference
  happens in the task-lifecycle wrapper, add it there
- The task-notification emitter (wherever the `<task-notification>` XML
  is assembled from the agent's final tool call) — add the
  `completion_state` field

### Tests / validation

- Spawn a dev agent with an intentionally-tight budget, confirm it
  commits at every checkpoint and that the parent detects `partial`
  on exhaustion.
- Retry a truncated agent and confirm the parent refuses to mark the
  task complete until the verify step passes.

### Effort estimate

**L** — touches agent prompts, task-lifecycle wrapper, and parent
system instructions. Non-trivial testing surface.

### Dependencies / blockers

FRW-BL-001 should land first or in parallel; a partial-commit discipline
is useless if the commits land in the wrong filesystem.

---

## FRW-BL-003: Reviewer output truncation loses the verdict

- **Severity**: **High**
- **Surfaced during**: CLEAR autonomous run, reviewer `aabfad27786f0ab67`
  for ARCH-001 slice 4.

### Why

Reviewer agents are instructed to produce findings at the end of their
response (the "compose the review now" pattern). When the agent exhausts
budget before emitting the verdict, the entire decision is lost — parent
sees only the pre-verdict exploration trail.

### Description

Observed: ARCH-001 slice 4 reviewer's final tool output was literally:

> "The `bool _` parameter in the `[InlineData]` items (always `false`) is
> vestigial — it carries no value and looks like a leftover from
> copy-paste or an abandoned plan to parameterise the expected-exception
> type. Let me check one more thing about the DI gap."

That was the ENTIRE delivered content — no PASS/FAIL, no blocker /
warning / nit breakdown, no structured finding list. The reviewer had
**identified a real DI gap** (later confirmed as a blocker by manual
inspection) but ran out of budget before emitting it.

Recovery cost: parent had to inspect the diff manually, re-derive the
findings from first principles, and fix them — essentially redoing the
reviewer's job.

### Solution

**Flip the reviewer output order — verdict first, evidence second:**

The reviewer prompt template currently reads (effectively) "investigate,
then compose the verdict." Change it to:

> **Your FIRST line of output MUST be:**
>
> ```
> VERDICT: PASS | FAIL (N blockers, M warnings, K nits)
> ```
>
> Emit this immediately after your initial read. Update it later if your
> investigation reveals more findings. Evidence, file:line references,
> and remediation suggestions come AFTER the verdict line. If the agent
> runs out of budget, the verdict line must already be on the record.

Additionally, structure the body:

```
VERDICT: ...

Blockers (must fix before merge):
  1. [file:line] <short description>
     Reasoning: <detail>
     Fix: <suggestion>

Warnings (should fix):
  ...

Nits (optional):
  ...
```

A truncated reviewer then loses the nits first, then the warnings, then
the blocker details — but always keeps the verdict + blocker count.

### Framework files to change

- `framework/packs/*/prompts/reviewer.md` — rewrite the output-order
  contract
- `framework/agent-prompts.md` — if the reviewer brief template lives
  there
- `framework/quality.md` — if the reviewer-output format is specified
  as part of the quality rubric

### Tests / validation

- Dispatch a reviewer with a tight budget against a known-complex diff;
  confirm verdict emits on first line.
- Dispatch against a trivial diff; confirm verdict is PASS with no noise.

### Effort estimate

**S** — prompt-only change.

### Dependencies / blockers

None.

---

## FRW-BL-004: Glob tool Windows path-separator false negatives

- **Severity**: **High**
- **Surfaced during**: CLEAR autonomous run, inspection of
  `clear-api/Clear.Api/Controllers/`.

### Why

On Windows, calling the Glob tool with a forward-slash pattern against
a directory whose files Windows reports with backslashes returns
**"No files found"** even when the files exist. Hidden false-negative
that doesn't fail loudly.

### Description

Observed during the ENG-016 investigation:

```
Glob(pattern: "clear-api/Clear.Api/Controllers/*.cs")
→ "No files found"
```

But the directory absolutely contained 8 `.cs` files. Confirmed via a
subsequent Bash `ls` that they were there all along.

The parent agent, believing the Glob result, concluded the ChatController
+ SettingsController didn't exist and dispatched a developer agent to
build them from scratch. When the dev agent returned (eventually, after
FRW-BL-001 + FRW-BL-002 issues), the parent discovered the files had
been there the whole time — just unstaged in `git status` from an
earlier unfinished agent session.

**Cost**: ~45 minutes of phantom agent dispatch + salvage + rework.

### Root cause guess

The Glob tool matches the pattern against whatever `fs.readdir` or
equivalent returns. On Windows, this is sensitive to:
- Path separator (`/` vs `\`)
- Case sensitivity (though NTFS is usually case-insensitive)
- Whether the root of the pattern exists relative to the agent's CWD

Patterns that start without a `./` prefix and use forward slashes on
Windows seem to under-match.

### Solution

1. **Normalize the Glob input**: inside the Glob tool, before matching,
   replace backslashes with forward slashes in the scanned file paths.
   Then match the pattern against the normalized paths.
2. **Normalize the pattern too**: strip any leading `./`, replace
   `\\` with `/`.
3. **Surface a warning when the root exists but 0 matches**: if
   `path.dirname(pattern)` exists as a directory on disk but the glob
   returns zero, emit a "root directory exists but no files matched
   pattern — check case sensitivity / separator" warning in the tool
   result. This turns a silent false-negative into an investigable
   signal.

### Framework files to change

This is almost certainly in the Claude Code harness rather than the
Volundr framework per se — flag it upstream as an Anthropic bug if the
Glob tool ships in the client rather than framework-defined. For the
Volundr side:

- `framework/system-instructions.md` — add a note that Glob on Windows
  can false-negative; recommend cross-checking with `Bash("ls ...")` on
  empty results when the existence of the directory is certain.

### Tests / validation

- Pattern `clear-api/Clear.Api/Controllers/*.cs` against a Windows
  filesystem with 8 `.cs` files must return all 8.
- Pattern with empty result must be unambiguously "zero matches
  confirmed" vs. "scan didn't cover this path."

### Effort estimate

**S** for the Volundr-side docs note. The upstream Glob fix is out of
scope for Volundr.

### Dependencies / blockers

None for the docs note. The real fix depends on the Glob tool
implementation being accessible.

---

## FRW-BL-005: Forge API — `backlog → done` requires three sequential PATCH calls

- **Severity**: **Medium**
- **Surfaced during**: Every CLEAR card closed from backlog this session
  (7 cards: ENG-016, NET-005, SCN-002, SCN-003, OPS-004, OPS-002, OPS-005,
  SEC-008, FE-004, FE-005).

### Why

The Forge guards against careless card closes by requiring a card to
pass through `in_progress` before reaching `done`, and by requiring ISC
(inline success criteria) to exist before leaving `backlog`. Both guards
are valuable in isolation but compose into a three-step ritual that
doesn't match the real workflow of "close this retroactively — evidence
is already on main."

### Description

Observed sequence, repeated per card:

```
PATCH /api/cards/CLR-ENG-016 { status: "done", quality: {...} }
→ HTTP 400 "Card cannot leave backlog: ISC criteria are required before starting work"

PATCH /api/cards/CLR-ENG-016 { isc: [...] }
→ HTTP 200

PATCH /api/cards/CLR-ENG-016 { status: "in_progress" }
→ HTTP 200

PATCH /api/cards/CLR-ENG-016 { status: "done", quality: {...} }
→ HTTP 200
```

**Three round-trips** per card, every time, for work that is already
merged to main. Across 10 cards this session, that's 30+ API calls just
on the close dance, plus the cognitive overhead of remembering the
sequence. Easy to forget the in-between `in_progress` transition and get
a silent 400.

### Solution

**Option A (preferred): atomic retroactive-close endpoint.**

Add `POST /api/cards/:id/close` that accepts:

```
{
  isc: [...],
  quality: { completeness, codeQuality, formatCompliance, correctness, implementationType },
  evidence: "string describing where the work shipped"
}
```

The endpoint:
- Validates ISC + quality are present (both required)
- Internally transitions the card backlog → in_progress → done in a
  single transaction
- Records an audit entry with `closeType: "retroactive"` vs.
  `closeType: "progressive"` (the latter being the normal
  backlog-first-then-start-work flow)

**Option B: relax the guard for PATCH.**

Accept `PATCH /api/cards/:id` with `{ isc, status: "done", quality }`
as a single atomic write. Require all three fields when transitioning
directly from backlog; reject if only one is present.

Option A is cleaner because it makes the retroactive-vs-progressive
distinction explicit in the audit trail.

### Framework files to change

- `dashboard/api/routes/cards.ts` (or equivalent) — add the
  `POST /cards/:id/close` handler
- `framework/system-instructions.md` — document the new endpoint as the
  canonical "close a retroactively-shipped card" pattern
- `framework/agent-prompts.md` — if there's a "closing cards" section,
  update it to use the atomic endpoint

### Tests / validation

- POST /close on a backlog card with full payload → card ends up done,
  audit entry `closeType: "retroactive"`.
- POST /close on a backlog card with missing ISC → 400.
- POST /close on an in_progress card → works, audit entry
  `closeType: "progressive"`.

### Effort estimate

**S** for the API route addition, **S** for the agent-side adoption.

### Dependencies / blockers

None. Backwards-compatible addition.

---

## FRW-BL-006: Forge API endpoint shape is inconsistent / undiscoverable

- **Severity**: **Medium**
- **Surfaced during**: Every agent that needed to query project state.

### Why

There's no OpenAPI / swagger / `/api/` index document for the Forge
dashboard's REST surface. Endpoint paths must be discovered by trial
and error.

### Description

Examples observed:

```
GET /api/projects/clear/cards        → 200 OK (JSON array)
GET /api/cards?projectId=clear       → "" (empty body, 200-ish response)
GET /api/projects/clear              → 200 OK (metadata, no cards nested)
GET /api/cards/CLR-ENG-008           → 200 OK (single card)
```

Had to probe each one to learn the shape. No single source of truth for
"what endpoints exist, what they return, what path params / query params
they accept."

### Solution

1. Ship an OpenAPI 3 doc at `GET /api/openapi.json` (or `/swagger.json`)
   that enumerates every endpoint, query param, request body, and
   response shape.
2. Link to it from the dashboard's homepage so humans + agents can
   introspect.
3. Optional: a human-readable `/api/` index page that lists the top 10
   most-used endpoints.

### Framework files to change

- `dashboard/api/openapi.<ts|json>` — new file
- `dashboard/api/index.ts` (or equivalent) — wire the `/api/openapi.json`
  route
- `framework/advanced-features.md` — add a "Forge API reference" section
  pointing at the OpenAPI doc
- `framework/system-instructions.md` — tell agents that the canonical
  API shape is at `/api/openapi.json` so they can fetch + introspect
  instead of guessing

### Tests / validation

- `curl /api/openapi.json | jq '.paths | keys'` returns the full
  endpoint list.
- An agent that hits an undiscovered endpoint can recover by fetching
  the OpenAPI doc.

### Effort estimate

**M** — requires writing the OpenAPI spec once and keeping it in sync.

### Dependencies / blockers

None.

---

## FRW-BL-007: Task notification contains conflicting guidance about output files

- **Severity**: **Medium**
- **Surfaced during**: Every `local_agent` task completion this session.

### Why

The `<task-notification>` block for a completed local_agent task says:

> `output-file: C:\...\tasks\<id>.output`
> `Read the output file to retrieve the result`

But the deferred-tool schema for `TaskOutput` tells the agent:

> "For local_agent tasks: use the Agent tool result directly. Do NOT
> Read the .output file — it is a symlink to the full sub-agent
> conversation transcript (JSONL) and will overflow your context window."

Two contradictory instructions arrive within the same tool-result
surface. Agents who follow the first prompt instantiate a catastrophic
context overflow; agents who know to ignore it learn to distrust the
notification. Bad either way.

### Description

Observed on every reviewer + dev agent completion. I got lucky because
I had earlier-in-session context warning me away. A cold agent
encountering this notification for the first time would plausibly
`Read()` the output file, consume tens of thousands of lines of JSONL,
and corrupt its working context.

### Solution

Change the local_agent task notification to inline the agent's primary
result (the `<result>` block it already contains) and **not** mention
the output file at all for the "retrieve the result" use case. Reserve
the output-file path only for a debug footer:

```
<task-notification>
  <task-id>...</task-id>
  <status>completed</status>
  <summary>Agent "..." completed</summary>
  <result>
    [inline result text here]
  </result>
  <usage>...</usage>

  <!-- For debugging only: not for agent consumption. -->
  <_debug output-file="...transcript.jsonl" />
</task-notification>
```

And delete the misleading "Read the output file" prompt.

### Framework files to change

- Wherever the `<task-notification>` XML is composed (likely in the
  Claude Code harness rather than framework-side) — flag upstream.
- `framework/system-instructions.md` — until the upstream fix lands,
  explicitly document "for local_agent tasks, the agent's reply is
  inline in `<result>`; never Read the output-file path."

### Tests / validation

- A cold agent presented with a local_agent task notification must be
  able to consume the result without reading any external file.

### Effort estimate

**S** for the docs note. Upstream fix out of scope.

### Dependencies / blockers

None.

---

## FRW-BL-008: Reviewer-brief prompts are verbose and ad-hoc

- **Severity**: **Medium**
- **Surfaced during**: 5+ reviewer dispatches this session.

### Why

Every reviewer dispatch required hand-crafting a 400-600-word brief
from scratch. Typical brief contents:

1. Card ID + branch + base commit
2. Context paragraph (what shipped, what the prior slice did)
3. List of files touched + their line count + purpose
4. Specific concerns to validate (card-spec-derived)
5. Standard convention checks (lint conventions, tests, commit
   message accuracy)
6. Output format contract (PASS/FAIL, verdict-first, file:line
   references)

Items 3 and 4 are genuinely card-specific; items 1, 2, 5, 6 are
identical across every reviewer dispatch. Writing them manually each
time costs ~3-5 minutes of context and burns parent-agent tokens.

### Description

Example from this session (truncated to illustrate):

```
Blind review commit 7dea94c on branch feat/clr-eng-008-gp006-gp007-gp009
in C:\...\clr-eng-008-phase2-remainders.

Closing ISC items: GP-006 (...), GP-007 (...), GP-009 (...).

You have no context from the developer. Read the diff (git diff d0620d6)
and judge against the GovernancePolicyScanner conventions already on
main (primary partial at clear-api/Clear.Engine/Scanners/Governance
PolicyScanner.cs, existing checks GP-001..005, ...).

What to check:
- Each new check matches the existing hierarchy-error + empty-hierarchy
  error pattern (...)
- [5 more bullets of convention checks]
- Report PASS with 3-5 bullet strengths, or FAIL with specific
  Blockers / Warnings / Nits ... Keep the report under 400 words.
- DO NOT touch the code - read-only review.
```

Every reviewer got a variant of this, with 60-70% of the text identical.

### Solution

Add a `reviewer-for-card` composite command / skill that takes:
- `card_id` (required)
- `branch` (defaults to `feat/<card-id>-*`)
- `base_commit` (defaults to `main`)
- `specific_concerns` (optional free-form paragraph for card-specific
  focus)

And auto-constructs the full brief by:
1. Looking up the card description + ISC from the Forge API
2. Running `git diff <base>..<branch> --stat` to list touched files
3. Emitting the standard convention-check list + output-format contract
   from a template
4. Appending the card's specific concerns from `specific_concerns` or
   inferring them from the ISC evidence fields
5. Dispatching a reviewer agent with the composed brief

Parent agent invokes: `reviewer-for-card CLR-ENG-008 --specific-concerns
"GP-009 hierarchy-error status semantic; duplicate-archetype warning
parity with GP-001"` — 1 line instead of 40.

### Framework files to change

- `framework/packs/*/prompts/reviewer-brief-template.md` — the standard
  convention-check list + output-format contract
- `framework/skills/reviewer-for-card.md` — new skill that composes the
  brief + dispatches the reviewer
- `framework/system-instructions.md` — document the skill + when to
  prefer it over hand-crafted briefs

### Tests / validation

- Invoke the skill against a known merged commit; confirm the reviewer
  receives a well-formed brief and produces a usable verdict.
- Measure: parent agent tokens used to dispatch the reviewer; target
  < 50 for the skill invocation vs. 400-600 for the hand-crafted brief.

### Effort estimate

**M** — skill plumbing + template design + integration testing.

### Dependencies / blockers

Helpful (not required): FRW-BL-006 (OpenAPI) — the skill's card lookup
is cleaner with a documented API.

---

## FRW-BL-009: Parallel dev + reviewer dispatches can contest the same worktree lock

- **Severity**: **Low**
- **Surfaced during**: CLEAR autonomous run, transient observation — not
  a hard failure this session, but noticed when dispatching a reviewer
  against a worktree while another agent was operating in an adjacent
  one.

### Why

Git worktrees share the same `.git/index.lock` (or equivalent) in some
operations. Two agents reading from different worktrees of the same repo
should be fine in principle, but `git worktree remove` or a `git fetch`
during another agent's run can deadlock.

### Description

Not a reproducible hard failure this session — behaviour was correct
but felt fragile. Flagging now before it bites in a larger team run.

### Solution

Document the serialization contract:
- At most one agent per worktree at any time.
- `git worktree remove` must only be called when no agent is active in
  that worktree.
- Cleanup should happen after the agent's final commit-and-return.

Optional: a framework-side lock file per worktree that agents acquire
before tool calls and release on exit. Probably overkill unless this
escalates.

### Framework files to change

- `framework/system-instructions.md` — worktree serialization note in
  the parallelism / delegation section

### Tests / validation

- Dispatch 3 dev agents against the same project in parallel against 3
  distinct worktrees; confirm no contention.

### Effort estimate

**S** docs only.

### Dependencies / blockers

None.

---

## FRW-BL-010: Bash hook rejection messages could suggest the right command

- **Severity**: **Low**
- **Surfaced during**: CLEAR autonomous run, `git add -A` attempts.

### Why

The `.claude/hooks/enforce-bash-rules.js` hook blocks `git add -A` (and
related commands) with:

> `BLOCKED: Use specific file paths instead of 'git add -A'. Example:
> git add src/file1.ts src/file2.ts`

Valid principle — the hook prevents accidentally staging unrelated
files. But the example is abstract; the agent has to pivot to a
separate `git status --porcelain` call to see what it actually needs to
add, then construct the real command. That's 2-3 tool calls per commit.

### Description

Observed ~10 times this session. Every time: `git add -A` → rejection
→ `git status --short` → construct explicit list → re-run `git add
<file1> <file2> ...`.

### Solution

The hook, on rejection, should either:

1. **Inline the suggested command**: run `git status --porcelain` in
   the rejection path and append its output to the error message so the
   agent can construct the explicit command from one tool result, not
   two.
2. **Show the current working tree state**: even without porcelain,
   running `git status -s` and embedding its output takes one shell
   call on the hook side and saves the agent an extra tool round-trip.

Preferred: option 1 because it gives the agent the list of files it
would have added, so it can pick intentionally.

### Framework files to change

- `.claude/hooks/enforce-bash-rules.js` — enrich the rejection payload

### Tests / validation

- Run `git add -A` with 3 uncommitted files; confirm the rejection
  message lists those 3 files as a suggested explicit command.

### Effort estimate

**S**.

### Dependencies / blockers

None.

---

## FRW-BL-011: Reviewer findings have no structured output format

- **Severity**: **Low-Medium**
- **Surfaced during**: CLEAR autonomous run, every reviewer dispatch.

### Why

Reviewer verdicts come as free-form prose. Parent agents parse this
prose heuristically to decide what to fix. There's no programmatic way
to:
- Track which findings were addressed vs. waived across commits
- Auto-generate TodoWrite tasks from blockers
- Verify via CI that a PR addresses all blockers before merge

### Description

A typical reviewer output looks like:

```
FAIL

Blockers:
1. GP-009 hierarchy-error status is Error but the canonical pattern is
   NotApplicable. ...
2. The GP-009 test method name directly contradicts its own assertion.
   ...

Warnings:
3. GP-006 and GP-009 silently drop duplicate-archetype-name warnings
   that GP-001 explicitly logs. ...
...
```

Useful for humans, but parsing "Blockers: list of 2" vs. "Warnings: list
of 2" vs. "Nits: list of 2" programmatically is heuristic at best.

### Solution

Additional to FRW-BL-003 (verdict-first), require the reviewer to emit
findings as **both** prose (for humans) and a structured JSON block at
the end:

```
VERDICT: FAIL (2 blockers, 2 warnings, 2 nits)

<human-readable prose as today>

```json
{
  "verdict": "FAIL",
  "blockers": [
    {
      "id": "B1",
      "file": "clear-api/.../GovernancePolicyScanner.Expansion.cs",
      "line": 2324,
      "summary": "GP-009 returns Error on hierarchyError; canonical pattern is NotApplicable",
      "suggested_fix": "Change CheckStatus.Error to CheckStatus.NotApplicable"
    },
    ...
  ],
  "warnings": [...],
  "nits": [...]
}
```

Parent agent parses the JSON block for automation; humans read the prose.

### Framework files to change

- `framework/packs/*/prompts/reviewer.md` — add the structured-output
  requirement alongside the verdict-first order from FRW-BL-003
- `framework/quality.md` — document the finding-JSON schema as canonical

### Tests / validation

- Dispatch a reviewer, parse the JSON block from its output, confirm
  keys + types are correct.
- Feed the JSON to a hypothetical "fix-blockers" skill; confirm it can
  auto-create TodoWrite tasks.

### Effort estimate

**M** — prompt + schema + downstream tooling.

### Dependencies / blockers

FRW-BL-003 (verdict-first) — do them together.

---

## FRW-BL-012: Framework doesn't eat its own dog food

- **Severity**: **Low**
- **Surfaced during**: OPS-002 slice in the CLEAR session.

### Why

The OPS-002 slice I shipped for CLEAR added commitlint + release-please
+ a full deploy pipeline + rollback workflow to `clear`. The Volundr
framework repo itself has:
- **No commitlint** — commit messages are loosely conventional but not
  enforced.
- **No release-please or automated versioning** — framework releases
  are manual.
- **No deploy pipeline** — dashboard docker-compose is run manually.

If the framework is going to require these patterns from the projects
it orchestrates (as it does, via the packs), it should adopt them
itself. Dog-food drives discovery of friction the way real projects can't.

### Description

Observed indirectly — the CLEAR session's OPS-002 was the first end-to-
end test of the deploy-pipeline pattern, and several small issues
surfaced (hardcoded vault.azure.net in Bicep, missing `@allowed` on
child modules, etc.) that a dog-food adoption in Volundr would have
caught earlier.

### Solution

1. Adopt commitlint on the Volundr repo with the same
   `@commitlint/config-conventional` + extended type list the CLEAR
   OPS-002 slice ships.
2. Set up release-please on the Volundr repo so framework versions are
   derived from commit history.
3. Document in the framework README that the framework is self-hosting
   on these patterns.

### Framework files to change

- `.github/workflows/commitlint.yml` — new
- `.github/workflows/release-please.yml` — new
- `commitlint.config.js` — new at repo root
- `README.md` — add a "Dog-fooding" section documenting the adopted
  patterns and how they're tested on the framework itself

### Tests / validation

- Open a PR with a non-conventional commit message; CI fails.
- Land a `feat:` commit; release-please opens / updates the release PR.

### Effort estimate

**S** — largely copy from the CLEAR OPS-002 shipping.

### Dependencies / blockers

None.

---

## FRW-BL-013: Card dependency graph enforces hard order even when non-blocking

- **Severity**: **Low**
- **Surfaced during**: CLEAR autonomous run, OPS-005 evaluation.

### Why

OPS-005 had `deps: ["CLR-OPS-004"]` — meaning the Forge treated it as
blocked until OPS-004 shipped. But the OPS-005 backend work (App Insights
SDK wiring, TelemetryClient, OpenTelemetry instrumentation) had already
landed via earlier ENG slices — it was 80-90% done on main before
OPS-004 even existed.

The hard dependency made it look like OPS-005 couldn't progress, which
hid the fact that the real remaining work was a 20-line frontend
App Insights bootstrap. I discovered this only by manual inspection of
Program.cs.

### Description

Deps are currently monolithic: a card is either "blocked on X" or not.
In reality, a card's scope often has sub-components with different
dependency structures.

### Solution

Make deps optionally granular. Instead of `deps: ["CLR-OPS-004"]`:

```
deps:
  - card: CLR-OPS-004
    blocks: ["backend-wiring", "frontend-integration"]
    waives_for: ["smoke-test"]
```

Or simpler — mark deps with a weight:

```
deps: ["CLR-OPS-004"]  # hard block (current behaviour)
soft_deps: ["CLR-FND-003"]  # helpful to have first but not required
```

Alternatively, just document the norm: when reviewing a backlog card,
**always** grep main for the feature name first to check if earlier
slices already landed the substrate. The Forge can surface this via a
"recent commits matching <card-id-short-title>" panel.

### Framework files to change

- `framework/system-instructions.md` — add the grep-main-first step to
  the card-scoping preflight
- `dashboard/components/CardDetail.tsx` (or equivalent) — add the
  recent-commits-matching panel

### Tests / validation

- On a card-detail page, the panel shows commits touching files the
  card's description references.

### Effort estimate

**M** — the dashboard panel needs fuzzy matching logic.

### Dependencies / blockers

FRW-BL-006 (OpenAPI) makes the dashboard panel easier to wire.

---

## FRW-BL-014: Code can land under card IDs whose cards are still in `backlog`

- **Severity**: **High**
- **Surfaced during**: CLEAR portal walk — four FE pages (`/tenants`,
  `/tenants/[id]`, `/tenants/[id]/remediation`, `/knowledge`) shipped as
  header-only stubs while cards CLR-FE-001..008 are all still `backlog`.

### Why

CLEAR's code shows ~70 cards done, and the app boots and serves data on
ports 5050/3030. But a portal walk revealed four routes that are literal
placeholder stubs (`<h1>Tenants</h1>` + one-line description, no list,
no table, no behaviour). Cross-checking the Forge board:

- `CLR-FE-001  [backlog]  Dashboard page with tenant cards`
- `CLR-FE-002  [backlog]  Scan results page with bar chart and heatmap`
- `CLR-FE-003  [backlog]  Scanner detail page with check table`
- `CLR-FE-004  [backlog]  AI chat sidebar panel`
- `CLR-FE-005  [backlog]  Interview wizard (hybrid chat + structured form)`
- `CLR-FE-006  [backlog]  Scan progress page with real-time SSE`
- `CLR-FE-007  [backlog]  Reports page with preview and export`
- `CLR-FE-008  [backlog]  Accessibility and theming`

Every one of these is `backlog`. Yet `DashboardShell`, `ScanProgressShell`,
`ReportsShell`, the interview page (46 lines), and the chat page (33 lines)
all exist and run. Meanwhile the TenantsList — which CLR-FE-001's title
literally promises — is an 8-line header-only stub.

This is **undetected scope drift**: some of the work got done (chaotically,
via whichever Developer teammate or direct tool call happened to be
active), some of it got skipped, and nothing closed the loop on either
side. The status column on the board is a lie — it reports `backlog` for
work that's 60% shipped, and `backlog` again for work that was never
started. A user cannot tell the difference.

The acute harm is that the project was declared **code-complete** and
entered the portal-walk phase, and only manual inspection surfaced the
four unfinished pages. In a no-human-in-the-loop autonomous run (the
stated long-term goal), this would have shipped as-is.

### Description

There is no gate in the framework today that ties file-landing to card
status. Specifically:

1. **Worktree entry** (`.claude/hooks/worktree-create.js`) does not
   validate that the associated card is `in_progress` or assigned to
   the claiming agent. A Developer teammate can enter a worktree for
   any card in any status.
2. **`enforce-card-deps.js` hook** only checks that *dependency* cards
   are `done` (line 45: `return !dep || dep.status !== 'done'`). It
   does not check that the *target* card has itself been claimed.
3. **Commit hooks** (`post-bash-git.js`) do not parse the card IDs out
   of commit messages and validate them against the board. A commit
   `feat(clr-fe-001): add tenants page stub` can land with CLR-FE-001
   still in `backlog`, and nothing notices.
4. **Card close-out flow** — the Developer-teammate SoP ends at DoD +
   reviewer sign-off, but there's no tripwire if a card is never
   claimed in the first place: Volundr can dispatch "build the tenants
   page" as a direct subagent call, the subagent edits `app/tenants/page.tsx`,
   the hook doesn't care, and the card silently stays in `backlog`.

### Solution

Three progressively-stronger gates, land in order:

**Gate 1 (minimum): Post-commit card-status validation.**
- Extend `post-bash-git.js` to parse `CLR-XX-NNN` / `<PROJECT>-<DOMAIN>-<N>`
  IDs out of the commit subject/body.
- For each referenced card, hit `GET /api/projects/{id}/cards/{cardId}`.
  If status == `backlog`, emit a **loud warning** in the hook stderr
  (non-blocking; we don't want to trap mid-commit) and enqueue a
  Volundr notification asking whether the card should be moved to
  `in_progress` retroactively.
- Also validate the referenced card *exists*. A commit citing a
  non-existent card ID should fail the hook hard.

**Gate 2: Worktree-entry status check.**
- `worktree-create.js` already resolves the active project path from
  the registry (commit `8fe769c`). Extend it: when the worktree is
  opened for a specific card ID (the path convention includes the
  card ID), refuse to create if the card's status is `backlog` unless
  the entering agent is explicitly claiming it as part of the same
  call. The claim transitions `backlog -> in_progress` atomically.

**Gate 3: Pre-close portal-walk checklist.**
- Before a project can transition from `implementation` to `complete`
  phase, the Forge API enforces: **every route referenced in any card's
  acceptance criteria must either render the promised component or be
  explicitly flagged as out-of-scope with a reason.**
- Mechanically: each card with a UI scope emits an assertion like
  `route:/tenants => component:TenantsList`. The pre-close gate scans
  the repo for the route's `page.tsx`, hashes the rendered component
  tree, and compares against the card's expected component. Header-only
  stubs produce a low-complexity hash that the gate flags.
- This is the one that would have caught CLEAR's four stubs
  automatically.

Gate 1 is S effort. Gate 2 is M. Gate 3 is L but highest value.

### Framework files to change

- `.claude/hooks/post-bash-git.js` — add card-ID parser + status validator
- `.claude/hooks/worktree-create.js` — extend with status precondition
  + optional atomic claim
- `dashboard/apps/api/` (route handlers) — new endpoint
  `POST /api/projects/{id}/cards/{cardId}/claim` that is the only path
  to `backlog -> in_progress` and records the claimant
- `framework/system-instructions.md` — document the claim-before-work
  contract explicitly; remove any implicit permission for Volundr or
  Developer subagents to edit files for an unclaimed card
- `framework/quality.md` — add "card was claimed before work started"
  to the DoD
- `framework/agent-prompts.md` — update Developer teammate prompt
  template so the very first step is "claim the card" via the API
- (Gate 3) `dashboard/apps/api/src/gates/portal-walk.ts` — new
  pre-close validator with route/component assertions

### Tests / validation

- Gate 1: craft a commit `feat(clr-fe-999): noop` where CLR-FE-999
  doesn't exist. Commit hook fails.
- Gate 1: craft a commit `feat(clr-fe-001): real change` while CLR-FE-001
  is `backlog`. Commit succeeds but a warning appears in stderr and a
  Volundr notification fires.
- Gate 2: try `EnterWorktree` for a card in `backlog` without the
  `claim=true` flag. Fails with a message pointing at the claim endpoint.
- Gate 3: mark a project as code-complete while `app/tenants/page.tsx`
  is 8 lines and CLR-FE-001's acceptance criterion names `TenantsList`.
  Gate refuses to close; lists the stub as a blocker.

### Effort estimate

**M overall** — Gate 1 is a 45-minute change, Gate 2 is 2-3 hours
including the claim endpoint, Gate 3 is a 1-2 day project.

### Dependencies / blockers

None for Gate 1. Gate 2 benefits from FRW-BL-005 (status transitions
as a single call) but doesn't require it. Gate 3 benefits from
FRW-BL-011 (structured reviewer findings) for the component-hash
comparison.

---

## Triage summary

| ID | Severity | Effort | Cost this session |
|----|----------|--------|-------------------|
| FRW-BL-001 | **High** | M | ~60 min salvage across 3 agents |
| FRW-BL-002 | **High** | L | ~90 min salvage work |
| FRW-BL-003 | **High** | S | ~20 min reconstructing verdict |
| FRW-BL-004 | **High** | S | ~45 min phantom agent dispatch |
| FRW-BL-005 | Medium | S | ~10 min × 10 cards = 100 min API friction |
| FRW-BL-006 | Medium | M | ~15 min endpoint discovery |
| FRW-BL-007 | Medium | S | latent risk; no direct cost this session |
| FRW-BL-008 | Medium | M | ~30 min crafting reviewer briefs |
| FRW-BL-009 | Low | S | latent |
| FRW-BL-010 | Low | S | ~10 × 10 rejections = 100 min (!) |
| FRW-BL-011 | Low-M | M | latent |
| FRW-BL-012 | Low | S | indirect discovery friction |
| FRW-BL-013 | Low | M | ~15 min OPS-005 scoping |
| FRW-BL-014 | **High** | M | 4 CLEAR pages shipped as stubs while 8 FE cards sat in `backlog` undetected |

**Total observable time lost this session: ~6+ hours of friction across
14 framework issues.** Highest-ROI fixes are the five High-severity
items (BL-001 through BL-004, plus BL-014); a week's investment on
those would materially change the hit rate on autonomous runs. BL-014
in particular is the gate that would have caught the CLEAR stubs before
code-complete was declared.

---

## Adding new cards to this backlog

When a framework issue surfaces in a real session:

1. Open a new `## FRW-BL-<next-id>: <issue>` section.
2. Fill every sub-section (Why / Description / Solution / Framework
   files / Tests / Effort / Dependencies). Resist the urge to skip
   sections — a blank agent six months from now needs every one of
   them.
3. Cross-reference from the **Triage summary** table.
4. Commit as `docs(framework): add FRW-BL-<id> <short title>`.

Do not delete cards when they're shipped. Mark them:

```
## FRW-BL-XXX: ... (SHIPPED in <commit-sha>, <date>)
```

Keep the description intact so future drift-analysis has the original
problem statement available.
