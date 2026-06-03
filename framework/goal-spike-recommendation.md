# Spike: Claude Code `/goal` as the autonomous completion driver (FRW-BL-036)

Spike of Claude Code's `/goal` slash-command as the driver for autonomous "keep going until done"
runs, with a REAL completion condition, evaluated for cooperation with Volundr's existing
Stop-hook loop / 8-block cap, ending in a decisive adopt-vs-keep recommendation.

Deliverables: `scripts/goal-evaluator.mjs` (the completion-condition evaluator) +
`scripts/goal-evaluator.test.mjs` (22 assertions, all green) + this writeup.

---

## (a) The REAL completion condition

`/goal` only works if "done" is a precise predicate, not a vibe. A per-card ISC pass is NOT done —
the quality gate answers "did THIS card's binary acceptance hold?", a far finer signal than "should
the whole autonomous LOOP terminate?". `scripts/loop-controller.mjs::detectCompletion(state)`
already gives the coarse loop-terminator (complete when `explicitComplete` OR
`readyCardCount===0 && unblockedBacklogCount===0`). The spike COMPOSES it (never modifies it) into a
strictly stronger goal predicate, `evaluateGoal(state) → { goalMet, reason, blocking }`.

`goalMet === true` ONLY when ALL of the following hold simultaneously:

1. `detectCompletion(state).complete === true` — backlog genuinely drained, OR explicit completion
   was declared. (Composed from the merged loop-controller; its reason is surfaced verbatim.)
2. `state.finalBuildGateGreen === true` — the FINAL project build gate is green. A drained backlog
   with a red build is a failed run, not a met goal.
3. No `partialCards` and no `failedCards` pending — graceful-degradation / partial-results work
   (FRW-BL-052) and failed cards are outstanding work; a goal is not met while they linger. Counts
   accept either an array or a number, and negative/NaN clamp to 0 (defensive, never false-blocks).
4. `state.activeSubagents === 0` — **SUBAGENT-AWARE.** The evaluator REFUSES to declare the goal met
   while any teammate/subagent is in-flight, even if conditions 1–3 momentarily look clean.

`blocking[]` enumerates, in evaluation order, exactly which conditions are unmet (empty iff
`goalMet`), so the loop log and any operator can see precisely what is left.

**Rationale.** Each condition closes a specific false-positive: (1) prevents stopping with
schedulable work; (2) prevents declaring victory on a red build; (3) prevents abandoning
degraded/failed cards; (4) prevents the single most dangerous race — declaring done while work is
still executing in a worktree (see (b)). The predicate is conservative by construction: it errs
toward "not done," which is the correct bias for an autonomous loop (a false "not done" just costs
one more cheap evaluation; a false "done" abandons real work).

---

## (b) Cooperation with the Stop-hook loop + the 8-block cap

Per the authoritative FRW-BL-028 findings (project journal):

- **There are NO Stop/SubagentStop hook block-retries in Volundr.** The
  `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default **8**) governs **Stop-class hooks ONLY**.
- Volundr's exit-2 "keep going" loops are **PreToolUse / TeammateIdle / TaskCompleted /
  WorktreeCreate** — **none are Stop-class** — so the 8-block cap **cannot fire from them.** There is
  no cap collision to engineer around.
- Therefore `/goal` cooperates by being an **ADVISORY completion evaluator**, NOT another Stop-hook
  that block-retries. `evaluateGoal` is a pure verdict function the `/goal` loop CONSULTS after each
  turn; it never emits exit-2, never blocks, never consumes a Stop-hook block budget. It sits
  orthogonally beside the existing exit-2 loops rather than competing with them.
- **Subagent-aware by design.** Claude Code's `/goal` already WAITS for subagents to finish before
  evaluating completion. Condition 4 (`activeSubagents === 0`) makes that guarantee explicit and
  enforces it even if `/goal` were ever asked to evaluate early: the verdict is "not met" with a
  clear `blocking` entry while any subagent is in-flight. This is the safety property that makes the
  evaluator safe to consult at any moment without racing teammate worktrees.

Net: zero interaction with the 8-block cap (advisory, not Stop-class), and a hard interlock against
the in-flight-subagent race.

---

## (c) Recommendation — DECISIVE

**KEEP Volundr's current keep-going logic as the driver. ADOPT the `evaluateGoal` predicate as the
completion CONDITION the loop consults — but do NOT hand the driving loop over to `/goal`.**

Reasoning:

1. **The driver is not the gap; the completion condition was.** Volundr's exit-2 loops
   (PreToolUse/TeammateIdle/TaskCompleted/WorktreeCreate) already drive multi-teammate, worktree-
   isolated, cost-gated parallel execution — capabilities `/goal` does not replicate. The thing
   worth taking from the `/goal` model is its *discipline of a single explicit completion predicate*,
   which this spike now provides as composable code.
2. **`/goal` as the DRIVER would regress orchestration.** Volundr's value is the team lead spawning
   ≤4 Developer teammates per round, cross-domain dependency sequencing, cost gating, and worktree
   isolation. A single `/goal` "keep going" turn-loop has no native concept of these. Replacing the
   driver would trade a working orchestrator for a thinner loop.
3. **No cap risk to chase.** Since the 8-block cap is Stop-class-only and Volundr's loops are not
   Stop-class, there is no cap-exhaustion problem that adopting `/goal` would solve. The motivating
   worry behind the spike does not exist.
4. **Cheap, conservative, subagent-safe.** `evaluateGoal` is pure, dependency-free, and biased
   toward "not done." Consulting it costs nothing and cannot race subagents.

### Migration notes (adopting the predicate, not the driver)

- Have the existing loop call `evaluateGoal(state)` once per round AFTER all teammates/subagents in
  that round have reported (so `activeSubagents === 0` reflects reality). Terminate the autonomous
  run only when `goalMet === true`; otherwise log `reason` / `blocking` and continue. No Stop-hook
  is added, so the 8-block cap is untouched.
- Populate `state` from existing sources: `readyCardCount` / `unblockedBacklogCount` from the card
  scheduler, `finalBuildGateGreen` from the final build gate (`framework/quality.md`),
  `partialCards` / `failedCards` from the degradation/partial-results path (FRW-BL-052),
  `activeSubagents` from the live teammate/subagent count.
- `detectCompletion` stays the single source of truth for "is there schedulable work?";
  `evaluateGoal` layers the build-gate / partials / subagent interlocks on top. Keep them separate.
- If a true operator `/goal "<text>"` UX is ever wanted, wire it to set `explicitComplete` (operator
  declares done) — it flows through `detectCompletion` → `evaluateGoal` unchanged. That gives the
  ergonomics of `/goal` without ceding the orchestration loop.
