"""
One-shot script that POSTs the framework-improvement-backlog cards to the
Forge's volundr-meta project. Idempotent: PATCHes existing cards with the
full description, creates them otherwise. Safe to re-run.

Invoke:  python scripts/post-improvement-backlog.py
Requires: Forge running on localhost:3141; volundr-meta project exists.
"""
import json
import sys
import urllib.request

FORGE = "http://localhost:3141"
PROJECT = "volundr-meta"
EPIC_ID = "834e6dcf-8c8e-4771-9e9c-66c257762361"

# Each card is a dict with id, title, size, priority, description.
# Descriptions mirror docs/improvement-backlog.md but condensed where
# the markdown would bloat the card body.
CARDS = [
    {
        "id": "FRW-004",
        "title": "Dev agent worktree placement unreliable on cross-repo projects",
        "size": "M",
        "priority": "1.0",
        "description": """**Severity: HIGH** — surfaced during CLEAR autonomous run 2026-04-23.

## Why
When Volundr is loaded against a project OUTSIDE the framework repo, dev agents spawned with `isolation: "worktree"` sometimes land in `volundr/.claude/worktrees/agent-<id>/` (framework repo) instead of `<project>/.claude/worktrees/<slug>/` (actual project).

## Observed
Hit rate: 3 of 4 dev agents this session landed in the wrong place. ENG-008 Phase-2 correct; ENG-016, OPS-004, SCN-002-slice-1 all landed in the Volundr repo. ENG-016 spent ENTIRE budget on wrong filesystem, shipped zero commits.

## Description
Agent receives worktreePath pointing at the Volundr repo, writes code into an empty tracking directory, returns `status: completed` with truncated summary, ships nothing. Parent must stash in-memory edits manually and redo the scope.

Commit `8fe769c fix: worktree hook resolves active project path from registry` suggests the issue was known; fix is either incomplete or races on first-fire dispatches.

## Root-cause hypothesis
The worktree-placement hook reads from `VLDR_HOME/projects/registry.json`. If the parent is cwd'd in the framework repo while the active project points elsewhere, and the hook falls back to parent-cwd on any registry lookup failure, it lands in the wrong filesystem.

## Solution
1. **Agent-side preflight**: first action after EnterWorktree is `pwd` + `git rev-parse --show-toplevel`; if mismatch with registry-resolved path, abort with explicit error.
2. **Framework-side**: audit the worktree-placement hook resolver; no cwd fallback; block dispatch with explicit error if registry lookup fails; log resolved path on every dispatch.
3. **Cleanup**: the empty `volundr/.claude/worktrees/agent-<id>/` directories that get created even for correct dispatches are confusing. Either remove them or rename to something clearly labelled as tracking metadata.

## Framework files to change
- `.claude/hooks/worktree-resolver.{js,ts}` (exact filename — grep for the hook)
- `framework/system-instructions.md` — add preflight sanity check to developer / devops / qa teammate opening prompts
- `framework/agents/registry.ts` if the hook reads from here
- `framework/packs/*/prompts/developer.md` — add preflight to the developer prompt template

## Tests / validation
Repro: spawn a developer agent in worktree isolation from a Volundr session targeting a non-Volundr project 10 times; all 10 must land in the correct project's worktrees directory.

Regression test: add CI integration test that spawns a dummy agent against a fixture project and asserts worktree path.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-001`.

## Cost this session
~60 minutes salvage across 3 failed agents.""",
    },
    {
        "id": "FRW-005",
        "title": "Agent budget exhaustion produces no partial-commit checkpoint",
        "size": "L",
        "priority": "1.0",
        "description": """**Severity: HIGH** — surfaced during CLEAR autonomous run 2026-04-23.

## Why
When a sub-agent runs out of token budget mid-implementation, it returns `status: completed` to the parent with a truncated summary ending mid-sentence (e.g. `"Now let me write the test files..."`). The parent has NO structural signal that the work was cut short vs. genuinely complete.

## Observed
Hit rate: ~50% of dev agents this session exhausted budget with incomplete work; every one returned `completed`.

**SCN-002 slice 1 (agent `a560a55e`)**: Shipped models + 3 Graph reader methods + scanner pre-fetch block (~215 LoC across 3 files). NEVER committed. Summary ended: `"Now let me implement the three checks... Step 3: Update IdentityAccessScanner.cs: First, update..."`. Status: `completed`.

**OPS-004 (agent `afadb2f4`)**: Shipped 8 Bicep modules (~1400 LoC), committed. Timed out fixing final 5 lint warnings. Summary ended: `"Now fix the hardcoded vault.azure.net in the placeholder URIs - use..."`. Status: `completed`.

**ENG-016 (agent `ae4fa0ed`)**: Worked on wrong filesystem (FRW-004), exhausted budget, shipped nothing. Status: `completed`.

## Impact
Parent agent must inspect EVERY sub-agent's worktree manually to check whether work is real or stub-and-bail. "Run in background" promise undermined. Time cost this session: ~90 minutes of salvage across 3 agents.

## Solution
Three layers, additive:

1. **Agent-side periodic checkpoint** (belts): every sub-agent with `isolation: "worktree"` must commit `WIP: <slug>` every N tool calls or every ~20% of estimated token budget. An agent that ends without a commit has shipped nothing; framework should flag it.

2. **Structured completion state on return notification** (braces): add `completion_state: complete | partial | aborted` field to the task notification. Inferred heuristically:
   - `complete` — last 3 tool calls: Bash (build/test) + Write/Edit + Bash commit. Summary ends on period.
   - `partial` — last tool call is Write/Edit without subsequent build/test, OR summary ends on `:` / mid-sentence.
   - `aborted` — agent returned with error before any commit.

3. **Parent-side verify step** (trouser): whenever a worktree-isolated agent returns, parent must auto-run `git log --oneline <worktree-branch> -5` and diff-stat against main before trusting the "completed" signal. Pattern codified in Team Lead system instructions.

## Framework files to change
- `framework/system-instructions.md` — add parent-side verify step as mandatory post-dispatch action for background agents
- `framework/packs/*/prompts/developer.md` (+ devops / qa / designer) — add periodic-checkpoint instruction
- `framework/agents/registry.ts` — add completion-state inference in task-lifecycle wrapper
- The `<task-notification>` XML emitter — add `completion_state` field

## Tests / validation
- Spawn dev agent with tight budget; confirm it commits at every checkpoint; parent detects `partial` on exhaustion.
- Retry truncated agent; parent refuses to mark task complete until verify step passes.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-002`. Depends on FRW-004 (partial-commit discipline useless if commits land in wrong filesystem).

## Cost this session
~90 minutes salvage.""",
    },
    {
        "id": "FRW-006",
        "title": "Reviewer output truncation loses the verdict",
        "size": "S",
        "priority": "1.0",
        "description": """**Severity: HIGH** — surfaced during CLEAR autonomous run 2026-04-23.

## Why
Reviewer agents are instructed to produce findings at the end of their response (the "compose the review now" pattern). When the agent exhausts budget before emitting the verdict, the entire decision is lost — parent sees only the pre-verdict exploration trail.

## Observed
ARCH-001 slice 4 reviewer (`aabfad27786f0ab67`) final output was literally:

> "The `bool _` parameter in the `[InlineData]` items (always `false`) is vestigial — it carries no value and looks like a leftover from copy-paste or an abandoned plan to parameterise the expected-exception type. Let me check one more thing about the DI gap."

That was the ENTIRE delivered content — no PASS/FAIL, no blocker/warning/nit breakdown, no structured finding list. The reviewer had IDENTIFIED a real DI gap (later confirmed as a blocker by manual inspection) but ran out of budget before emitting it.

## Recovery cost
Parent had to inspect the diff manually, re-derive findings from first principles, and fix them — essentially redoing the reviewer's job.

## Solution
**Flip the reviewer output order — verdict first, evidence second.**

The reviewer prompt template currently reads "investigate, then compose the verdict." Change it to:

> **Your FIRST line of output MUST be:**
> ```
> VERDICT: PASS | FAIL (N blockers, M warnings, K nits)
> ```
> Emit this immediately after your initial read. Update it later if investigation reveals more findings. Evidence, file:line references, and remediation suggestions come AFTER the verdict line. If the agent runs out of budget, the verdict line must already be on the record.

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

A truncated reviewer loses nits first, then warnings, then blocker details — but always keeps the verdict + blocker count.

## Framework files to change
- `framework/packs/*/prompts/reviewer.md` — rewrite the output-order contract
- `framework/agent-prompts.md` — if the reviewer brief template lives there
- `framework/quality.md` — if reviewer-output format is specified as part of the quality rubric

## Tests / validation
- Dispatch a reviewer with tight budget against a known-complex diff; verdict emits on first line.
- Dispatch against a trivial diff; verdict is PASS with no noise.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-003`. Pair with FRW-014 (structured JSON output).

## Cost this session
~20 minutes reconstructing the lost verdict.""",
    },
    {
        "id": "FRW-007",
        "title": "Glob tool Windows path-separator false negatives",
        "size": "S",
        "priority": "1.0",
        "description": """**Severity: HIGH** — surfaced during CLEAR autonomous run 2026-04-23.

## Why
On Windows, calling the Glob tool with a forward-slash pattern against a directory whose files Windows reports with backslashes returns "No files found" even when files exist. Silent false-negative.

## Observed
```
Glob(pattern: "clear-api/Clear.Api/Controllers/*.cs")
→ "No files found"
```

The directory absolutely contained 8 `.cs` files. Confirmed via subsequent Bash `ls` that they were there all along.

## Cost
The parent agent, believing the Glob result, concluded ChatController + SettingsController didn't exist and dispatched a developer agent to build them from scratch. When the dev agent returned (eventually, after FRW-004 + FRW-005 issues), the parent discovered the files had been there the whole time — just unstaged in `git status` from an earlier unfinished agent session.

~45 minutes of phantom agent dispatch + salvage + rework.

## Root cause guess
The Glob tool matches the pattern against whatever `fs.readdir` or equivalent returns. On Windows, this is sensitive to:
- Path separator (`/` vs `\\`)
- Case sensitivity (though NTFS is usually case-insensitive)
- Whether the root of the pattern exists relative to the agent's CWD

Patterns that start without a `./` prefix and use forward slashes on Windows seem to under-match.

## Solution
1. **Normalize the Glob input**: inside the Glob tool, before matching, replace backslashes with forward slashes in the scanned file paths. Then match the pattern against normalized paths.
2. **Normalize the pattern too**: strip any leading `./`, replace `\\` with `/`.
3. **Surface a warning when the root exists but 0 matches**: if `path.dirname(pattern)` exists as a directory on disk but the glob returns zero, emit a warning in the tool result. Turns a silent false-negative into an investigable signal.

## Framework files to change
This is almost certainly in the Claude Code harness rather than the Volundr framework per se — flag it upstream as an Anthropic bug if the Glob tool ships in the client rather than framework-defined.

For Volundr side:
- `framework/system-instructions.md` — add note that Glob on Windows can false-negative; recommend cross-checking with `Bash("ls ...")` on empty results when directory existence is certain.

## Tests / validation
- Pattern `clear-api/Clear.Api/Controllers/*.cs` against Windows filesystem with 8 `.cs` files must return all 8.
- Empty result must be unambiguously "zero matches confirmed" vs. "scan didn't cover this path."

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-004`.

## Cost this session
~45 minutes phantom agent dispatch.""",
    },
    {
        "id": "FRW-008",
        "title": "Forge API — backlog to done requires three sequential PATCH calls",
        "size": "S",
        "priority": "2.0",
        "description": """**Severity: MEDIUM** — surfaced during every CLEAR card closed from backlog this session (7+ cards).

## Why
The Forge guards against careless card closes by requiring a card to pass through `in_progress` before reaching `done`, and by requiring ISC (inline success criteria) to exist before leaving `backlog`. Both guards are valuable in isolation but compose into a three-step ritual that doesn't match the real workflow of "close this retroactively — evidence is already on main."

## Observed
Per card, repeated:
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

**Three round-trips per card**, every time, for work already merged. Across 10 cards this session: 30+ API calls just on the close dance, plus cognitive overhead of remembering the sequence. Easy to forget the `in_progress` transition and get a silent 400.

## Solution
**Option A (preferred): atomic retroactive-close endpoint.**

Add `POST /api/cards/:id/close` accepting:
```json
{
  "isc": [...],
  "quality": { "completeness": 10, "codeQuality": 10, ... },
  "evidence": "string describing where the work shipped"
}
```

The endpoint:
- Validates ISC + quality are present (both required)
- Internally transitions backlog → in_progress → done in a single transaction
- Records audit entry with `closeType: "retroactive"` vs. `closeType: "progressive"` (progressive = normal backlog-first-then-start-work flow)

**Option B**: relax the PATCH guard. Accept `PATCH /api/cards/:id` with `{ isc, status: "done", quality }` as single atomic write. Require all three when transitioning directly from backlog; reject if only one present.

Option A cleaner because retroactive-vs-progressive distinction is explicit in audit trail.

## Framework files to change
- `dashboard/api/routes/cards.ts` (or equivalent) — add the `POST /cards/:id/close` handler
- `framework/system-instructions.md` — document the new endpoint as canonical "close a retroactively-shipped card" pattern
- `framework/agent-prompts.md` — if there's a "closing cards" section, update to use the atomic endpoint

## Tests / validation
- POST /close on backlog card with full payload → card ends up done, audit entry `closeType: "retroactive"`.
- POST /close on backlog card with missing ISC → 400.
- POST /close on in_progress card → works, audit entry `closeType: "progressive"`.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-005`.

## Cost this session
~10 min × 10 cards = ~100 min API friction.""",
    },
    {
        "id": "FRW-009",
        "title": "Forge API endpoint shape inconsistent / undiscoverable",
        "size": "M",
        "priority": "2.0",
        "description": """**Severity: MEDIUM** — surfaced during every agent that needed to query project state.

## Why
No OpenAPI / Swagger / `/api/` index document for the Forge dashboard's REST surface. Endpoint paths must be discovered by trial and error.

## Observed
```
GET /api/projects/clear/cards          → 200 OK (JSON array)
GET /api/cards?projectId=clear         → "" (empty body, 200-ish response)
GET /api/projects/clear                → 200 OK (metadata, no cards nested)
GET /api/cards/CLR-ENG-008             → 200 OK (single card)
POST /api/cards                        → 404
POST /api/projects/<id>/cards          → 201 (correct path)
```

Had to probe each one to learn the shape. No single source of truth for "what endpoints exist, what they return, what path params / query params they accept."

## Solution
1. Ship an OpenAPI 3 doc at `GET /api/openapi.json` (or `/swagger.json`) enumerating every endpoint, query param, request body, and response shape.
2. Link to it from dashboard homepage so humans + agents can introspect.
3. Optional: human-readable `/api/` index page listing top 10 most-used endpoints.

## Framework files to change
- `dashboard/api/openapi.{ts,json}` — new file
- `dashboard/api/index.ts` (or equivalent) — wire the `/api/openapi.json` route
- `framework/advanced-features.md` — add "Forge API reference" section pointing at the OpenAPI doc
- `framework/system-instructions.md` — tell agents that canonical API shape is at `/api/openapi.json` so they can fetch + introspect instead of guessing

## Tests / validation
- `curl /api/openapi.json | jq '.paths | keys'` returns the full endpoint list.
- An agent that hits an undiscovered endpoint can recover by fetching the OpenAPI doc.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-006`.

## Cost this session
~15 min endpoint discovery.""",
    },
    {
        "id": "FRW-010",
        "title": "Task notification contains conflicting guidance about output files",
        "size": "S",
        "priority": "2.0",
        "description": """**Severity: MEDIUM** — surfaced during every `local_agent` task completion this session.

## Why
The `<task-notification>` block for a completed local_agent task says:

> `output-file: C:\\...\\tasks\\<id>.output`
> `Read the output file to retrieve the result`

But the deferred-tool schema for `TaskOutput` tells the agent:

> "For local_agent tasks: use the Agent tool result directly. Do NOT Read the .output file — it is a symlink to the full sub-agent conversation transcript (JSONL) and will overflow your context window."

Two contradictory instructions arrive within the same tool-result surface.

## Impact
Agents who follow the first prompt instantiate a catastrophic context overflow; agents who know to ignore it learn to distrust the notification. Bad either way.

Observed on every reviewer + dev agent completion this session. Lucky because I had earlier-in-session context warning me away. A COLD agent encountering this notification for the first time would plausibly `Read()` the output file, consume tens of thousands of lines of JSONL, and corrupt its working context.

## Solution
Change the local_agent task notification to inline the agent's primary result (the `<result>` block it already contains) and NOT mention the output file at all for the "retrieve the result" use case. Reserve the output-file path only for a debug footer:

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

Delete the misleading "Read the output file" prompt.

## Framework files to change
- Wherever the `<task-notification>` XML is composed (likely in the Claude Code harness rather than framework-side) — flag upstream.
- `framework/system-instructions.md` — until upstream fix lands, explicitly document "for local_agent tasks, the agent's reply is inline in `<result>`; NEVER Read the output-file path."

## Tests / validation
A cold agent presented with a local_agent task notification must be able to consume the result without reading any external file.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-007`.

## Cost this session
No direct cost — latent risk for cold agents.""",
    },
    {
        "id": "FRW-011",
        "title": "Reviewer-brief prompts are verbose and ad-hoc — introduce reviewer-for-card skill",
        "size": "M",
        "priority": "2.0",
        "description": """**Severity: MEDIUM** — surfaced during 5+ reviewer dispatches this session.

## Why
Every reviewer dispatch requires hand-crafting a 400-600-word brief from scratch. Typical contents:
1. Card ID + branch + base commit
2. Context paragraph (what shipped, what the prior slice did)
3. List of files touched + line counts + purpose
4. Specific concerns to validate (card-spec-derived)
5. Standard convention checks (lint, tests, commit message accuracy)
6. Output format contract (PASS/FAIL, verdict-first, file:line references)

Items 3 + 4 are genuinely card-specific; items 1, 2, 5, 6 are IDENTICAL across every reviewer dispatch. Writing them manually each time costs ~3-5 minutes of context and burns parent-agent tokens.

## Observed
Example (truncated):
```
Blind review commit 7dea94c on branch feat/clr-eng-008-gp006-gp007-gp009 in C:\\...\\clr-eng-008-phase2-remainders.
Closing ISC items: GP-006 (...), GP-007 (...), GP-009 (...).
You have no context from the developer. Read the diff (git diff d0620d6)...
What to check:
- Each new check matches the existing hierarchy-error + empty-hierarchy error pattern (...)
- [5 more bullets of convention checks]
- Report PASS with 3-5 bullet strengths, or FAIL with specific Blockers / Warnings / Nits...
- DO NOT touch the code - read-only review.
```

Every reviewer got a variant of this, with 60-70% of the text identical.

## Solution
Add a `reviewer-for-card` composite command / skill taking:
- `card_id` (required)
- `branch` (defaults to `feat/<card-id>-*`)
- `base_commit` (defaults to `main`)
- `specific_concerns` (optional free-form paragraph for card-specific focus)

Auto-constructs the full brief by:
1. Looking up card description + ISC from Forge API
2. Running `git diff <base>..<branch> --stat` to list touched files
3. Emitting the standard convention-check list + output-format contract from a template
4. Appending the card's specific concerns from `specific_concerns` or inferring from ISC evidence fields
5. Dispatching a reviewer agent with the composed brief

Parent invokes: `reviewer-for-card CLR-ENG-008 --specific-concerns "GP-009 hierarchy-error status semantic; duplicate-archetype warning parity with GP-001"` — 1 line instead of 40.

## Framework files to change
- `framework/packs/*/prompts/reviewer-brief-template.md` — the standard convention-check list + output-format contract
- `framework/skills/reviewer-for-card.md` — new skill composing the brief + dispatching the reviewer
- `framework/system-instructions.md` — document skill + when to prefer over hand-crafted briefs

## Tests / validation
- Invoke the skill against a known merged commit; reviewer receives well-formed brief and produces usable verdict.
- Measure: parent tokens to dispatch reviewer; target < 50 for skill vs. 400-600 for hand-crafted.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-008`. Helpful (not required) dep: FRW-009 (OpenAPI makes the card lookup cleaner).

## Cost this session
~30 min crafting reviewer briefs across 5+ dispatches.""",
    },
    {
        "id": "FRW-012",
        "title": "Parallel dev + reviewer dispatches can contest the same worktree lock",
        "size": "S",
        "priority": "3.0",
        "description": """**Severity: LOW** — transient observation during CLEAR autonomous run 2026-04-23, not a hard failure this session.

## Why
Git worktrees share the same `.git/index.lock` (or equivalent) in some operations. Two agents reading from different worktrees of the same repo should be fine in principle, but `git worktree remove` or `git fetch` during another agent's run can deadlock.

## Observed
Not a reproducible hard failure this session — behaviour was correct but felt fragile. Flagging now before it bites in a larger team run.

## Solution
Document the serialization contract:
- At most one agent per worktree at any time.
- `git worktree remove` must only be called when no agent is active in that worktree.
- Cleanup happens after the agent's final commit-and-return.

Optional: framework-side lock file per worktree that agents acquire before tool calls and release on exit. Probably overkill unless this escalates.

## Framework files to change
- `framework/system-instructions.md` — worktree serialization note in the parallelism / delegation section

## Tests / validation
Dispatch 3 dev agents against the same project in parallel against 3 distinct worktrees; confirm no contention.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-009`.

## Cost this session
No observed cost — preventative.""",
    },
    {
        "id": "FRW-013",
        "title": "Bash hook rejection messages could suggest the right command",
        "size": "S",
        "priority": "3.0",
        "description": """**Severity: LOW** — surfaced ~10 times during CLEAR autonomous run 2026-04-23.

## Why
The `.claude/hooks/enforce-bash-rules.js` hook blocks `git add -A` (and related commands) with:
> `BLOCKED: Use specific file paths instead of 'git add -A'. Example: git add src/file1.ts src/file2.ts`

Valid principle — the hook prevents accidentally staging unrelated files. But the example is abstract; the agent has to pivot to a separate `git status --porcelain` call to see what it actually needs to add, then construct the real command. That's 2-3 tool calls per commit.

## Observed
~10 times this session. Every time: `git add -A` → rejection → `git status --short` → construct explicit list → re-run `git add <file1> <file2> ...`.

## Solution
The hook, on rejection, should either:

1. **Inline the suggested command**: run `git status --porcelain` in the rejection path and append its output to the error message. Agent constructs explicit command from ONE tool result, not two.
2. **Show current working tree state**: even without porcelain, running `git status -s` and embedding its output takes one shell call on hook side and saves an extra round-trip.

Preferred: option 1 because it gives the agent the list of files it would have added, so it can pick intentionally.

## Framework files to change
- `.claude/hooks/enforce-bash-rules.js` — enrich the rejection payload

## Tests / validation
Run `git add -A` with 3 uncommitted files; rejection message lists those 3 files as a suggested explicit command.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-010`.

## Cost this session
~10 × 10 rejections = ~100 min friction across the session (larger than severity suggests).""",
    },
    {
        "id": "FRW-014",
        "title": "Reviewer findings have no structured output format (JSON alongside prose)",
        "size": "M",
        "priority": "2.0",
        "description": """**Severity: LOW-MEDIUM** — surfaced during every reviewer dispatch this session.

## Why
Reviewer verdicts come as free-form prose. Parent agents parse this prose heuristically to decide what to fix. There's no programmatic way to:
- Track which findings were addressed vs. waived across commits
- Auto-generate TodoWrite tasks from blockers
- Verify via CI that a PR addresses all blockers before merge

## Observed
Typical reviewer output:
```
FAIL
Blockers:
1. GP-009 hierarchy-error status is Error but canonical pattern is NotApplicable. ...
2. The GP-009 test method name directly contradicts its own assertion. ...
Warnings:
3. GP-006 and GP-009 silently drop duplicate-archetype-name warnings ...
...
```

Useful for humans, but parsing "Blockers: list of 2" vs. "Warnings: list of 2" vs. "Nits: list of 2" programmatically is heuristic at best.

## Solution
Additional to FRW-006 (verdict-first), require reviewer to emit findings as BOTH prose (for humans) and a structured JSON block at the end:

```
VERDICT: FAIL (2 blockers, 2 warnings, 2 nits)

<human-readable prose as today>

\\`\\`\\`json
{
  "verdict": "FAIL",
  "blockers": [
    {
      "id": "B1",
      "file": "clear-api/.../GovernancePolicyScanner.Expansion.cs",
      "line": 2324,
      "summary": "GP-009 returns Error on hierarchyError; canonical pattern is NotApplicable",
      "suggested_fix": "Change CheckStatus.Error to CheckStatus.NotApplicable"
    }
  ],
  "warnings": [...],
  "nits": [...]
}
\\`\\`\\`
```

Parent parses the JSON block for automation; humans read the prose.

## Framework files to change
- `framework/packs/*/prompts/reviewer.md` — add the structured-output requirement alongside FRW-006's verdict-first order
- `framework/quality.md` — document the finding-JSON schema as canonical

## Tests / validation
- Dispatch a reviewer, parse the JSON block, confirm keys + types are correct.
- Feed the JSON to a hypothetical "fix-blockers" skill; confirm it can auto-create TodoWrite tasks.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-011`. Pair with FRW-006 (verdict-first) — do them together.

## Cost this session
No direct cost — enabler for future automation.""",
    },
    {
        "id": "FRW-015",
        "title": "Framework doesn't eat its own dog food (no commitlint / release-please on volundr repo)",
        "size": "S",
        "priority": "3.0",
        "description": """**Severity: LOW** — surfaced during OPS-002 slice in the CLEAR session.

## Why
The OPS-002 slice shipped for CLEAR adds commitlint + release-please + a full deploy pipeline + rollback workflow. The Volundr framework repo itself has:
- **No commitlint** — commit messages are loosely conventional but not enforced.
- **No release-please or automated versioning** — framework releases are manual.
- **No deploy pipeline** — dashboard docker-compose is run manually.

If the framework requires these patterns from projects it orchestrates (via packs), it should adopt them itself. Dog-fooding drives discovery of friction real projects can't.

## Observed
Indirect — the CLEAR session's OPS-002 was the first end-to-end test of the deploy-pipeline pattern, and small issues surfaced (hardcoded vault.azure.net in Bicep, missing @allowed on child modules) that dog-food adoption in Volundr would have caught earlier.

## Solution
1. Adopt commitlint on Volundr with same `@commitlint/config-conventional` + extended type list the CLEAR OPS-002 slice ships.
2. Set up release-please on Volundr so framework versions derive from commit history.
3. Document in framework README that the framework is self-hosting on these patterns.

## Framework files to change
- `.github/workflows/commitlint.yml` — new
- `.github/workflows/release-please.yml` — new
- `commitlint.config.js` — new at repo root
- `README.md` — add "Dog-fooding" section documenting adopted patterns + how they're tested on framework itself

## Tests / validation
- Open a PR with non-conventional commit message; CI fails.
- Land a `feat:` commit; release-please opens / updates the release PR.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-012`.

## Cost this session
Indirect discovery friction.

## Implementation hint
The CLEAR OPS-002 slice (commit in `internal/clear` main) contains working copies of all four files — largely copy-paste plus adjusting for the Volundr repo's structure.""",
    },
    {
        "id": "FRW-016",
        "title": "Card dependency graph enforces hard order even when non-blocking",
        "size": "M",
        "priority": "3.0",
        "description": """**Severity: LOW** — surfaced during CLEAR autonomous run 2026-04-23, OPS-005 evaluation.

## Why
OPS-005 had `deps: ["CLR-OPS-004"]` — the Forge treated it as blocked until OPS-004 shipped. But the OPS-005 backend work (App Insights SDK wiring, TelemetryClient, OpenTelemetry instrumentation) had ALREADY landed via earlier ENG slices — it was 80-90% done on main before OPS-004 even existed.

The hard dependency made it look like OPS-005 couldn't progress, which hid the fact that the real remaining work was a 20-line frontend App Insights bootstrap. Discovered this only by manual inspection of Program.cs.

## Description
Deps are currently monolithic: a card is either "blocked on X" or not. In reality, a card's scope often has sub-components with different dependency structures.

## Solution
Make deps optionally granular. Instead of `deps: ["CLR-OPS-004"]`:

```
deps:
  - card: CLR-OPS-004
    blocks: ["backend-wiring", "frontend-integration"]
    waives_for: ["smoke-test"]
```

Or simpler — mark deps with weight:
```
deps: ["CLR-OPS-004"]          # hard block (current behaviour)
soft_deps: ["CLR-FND-003"]     # helpful to have first but not required
```

Alternatively (cheaper), document the norm: when reviewing a backlog card, ALWAYS grep main for the feature name first to check if earlier slices already landed the substrate. The Forge can surface this via a "recent commits matching <card-id-short-title>" panel.

## Framework files to change
- `framework/system-instructions.md` — add grep-main-first step to card-scoping preflight
- `dashboard/components/CardDetail.tsx` (or equivalent) — add the recent-commits-matching panel

## Tests / validation
On a card-detail page, the panel shows commits touching files the card's description references.

## Links
Full detail in `docs/improvement-backlog.md#frw-bl-013`. FRW-009 (OpenAPI) makes the dashboard panel easier to wire.

## Cost this session
~15 min OPS-005 scoping before realising backend already shipped.""",
    },
]


def upsert_card(card):
    card_id = card["id"]
    url = f"{FORGE}/api/projects/{PROJECT}/cards"
    body = {
        "id": card_id,
        "epicId": EPIC_ID,
        "title": card["title"],
        "description": card["description"],
        "size": card["size"],
        "priority": card["priority"],
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"POST {card_id}: {resp.status}")
            return True
    except urllib.error.HTTPError as e:
        if e.code == 409 or e.code == 400:
            # Already exists - PATCH instead
            patch_url = f"{FORGE}/api/cards/{card_id}"
            patch_body = json.dumps({
                "title": card["title"],
                "description": card["description"],
                "size": card["size"],
                "priority": card["priority"],
            }).encode("utf-8")
            patch_req = urllib.request.Request(
                patch_url, data=patch_body, method="PATCH",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(patch_req) as presp:
                print(f"PATCH {card_id}: {presp.status}")
                return True
        else:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"POST {card_id} FAILED {e.code}: {err_body[:200]}")
            return False


if __name__ == "__main__":
    ok = 0
    for card in CARDS:
        if upsert_card(card):
            ok += 1
    print(f"\n{ok}/{len(CARDS)} cards registered.")
    sys.exit(0 if ok == len(CARDS) else 1)
