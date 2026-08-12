# Hook Coverage — which tools each guard actually guards

**Origin: FRW-BL-092.** Every shell safety guard in this framework was inoperative for the
PowerShell tool — the primary shell on the Windows dev machine — for an unknown number of sessions.
Nothing was wrong with the guards. They were registered with `matcher: "Bash"`, and PowerShell is a
separate tool name.

This document exists so that fact is looked up rather than rediscovered.

---

## The defect class

**Hook matchers key on TOOL NAME, not on capability.** A guard is exactly as wide as the set of tool
names it enumerates. Any sibling tool with the same capability and a different name is unguarded,
and unguarded looks identical to safe: the command runs, nothing complains, no event is logged.

The failure is invisible from the guard's own tests. `enforce-bash-rules.test.js` passed 51/51 the
whole time it was covering nothing on the shell actually in use, because a self-test drives
`matchBlocked()` directly and never asks *whether the hook is invoked*.

> A hook can be perfectly correct and simply never called. Testing the handler is not testing the
> registration. See the FRW-BL-091 retraction for what this costs when you mark it PASS.

## Registration is boot-read; hook bodies are not

Load-bearing when planning a fix, and the reason FRW-BL-092 needed two sessions:

| Change | When it takes effect | Verifiable in the session that makes it? |
|---|---|---|
| Hook **body** (patterns, logic, messages) | Next invocation — `node` runs fresh each time | **Yes**, immediately |
| Hook **registration** (`matcher`, hook list, `settings.json` env) | Next session boot | **No** — defer to a restart |

So a pattern-set fix can be proven end-to-end on the spot (FRW-BL-092 ISC-5 was), while a matcher
fix cannot be proven by the session that writes it (ISC-1/2/4 needed the following boot). Do not
manufacture a green result for the second kind — leave the ISC pending and say why.

## Coverage table

Verified 2026-08-11, session `a6cce6c6`, CLI 2.1.227.

| Matcher | Guards | Covers | Sibling tools with the same capability | Status |
|---|---|---|---|---|
| `Bash\|PowerShell\|Monitor` (PreToolUse) | `enforce-bash-rules`, `enforce-worktree-isolation` | Bash, PowerShell, Monitor | — | Bash + PowerShell **proven live**; `Monitor` added but registration unproven (FRW-BL-093) |
| `Bash\|PowerShell\|Monitor` (PostToolUse) | `post-bash-git` (commit card-ID validator, push receipt) | Bash, PowerShell, Monitor | — | as above |
| `Write\|Edit\|NotebookEdit` | `enforce-worktree-path-write` | Write, Edit, NotebookEdit | — | **CLOSED (FRW-BL-093)** — guard reads `file_path` OR `notebook_path`; registration unproven until a restart |
| `Agent` | `pre-agent-tool` (card/persona descriptor queue), `enforce-card-deps` | Agent | **`Workflow`** | **DEFERRED, documented below** — FRW-BL-094 |
| `Skill` | `enforce-tool-priority` | Skill | — | covered |
| `""` (all) | SessionStart/SubagentStart/SubagentStop/TaskCompleted/TeammateIdle/Stop/SessionEnd/PreCompact/PostCompact/WorktreeCreate/WorktreeRemove/ConfigChange/InstructionsLoaded/PostToolUseFailure/StopFailure | everything | — | empty matcher cannot have this bug |

`Monitor` needed **no code change**: its input field is `command`, the same field
`enforce-bash-rules` already reads. `NotebookEdit` did need one — it passes `notebook_path`, while
`enforce-worktree-path-write` read only `tool_input.file_path`, so adding it to the matcher alone
would have registered a hook that inspects `undefined` and passes everything. **Fixed in
FRW-BL-093**: `resolveWriteTarget()` resolves whichever field the tool sent and names it back in the
remediation message, because telling a NotebookEdit caller to correct their "file_path" is a dead
end. The code landed **before** the matcher, in that order, deliberately.

### The `Workflow` attribution gap — deferred, with the reason

`PreToolUse: Agent` runs `pre-agent-tool.js`, which parses `# CARD-XX-NNN:` and `personaId:` out of
an Agent prompt and writes them to a FIFO descriptor queue; `agent-start.js` pops that queue
(`:224`) and stamps the dashboard agents row (`:417-418`). The `Workflow` tool spawns subagents
**without invoking the Agent tool**, so nothing is ever written to the queue for them. `SubagentStart`
still fires (its matcher is `""`), so the row is created — just unattributed. Consequence:
workflow-spawned agents carry no `cardId`/`personaId`, which quietly weakens FRW-002 persona skill
extraction (it weights confidence on those rows), and `enforce-card-deps.js` never runs for them.

**Worse, and the real reason this needs its own card:** the pop is a *blind* FIFO, not keyed to the
starting agent. A workflow agent that starts while a genuine Agent-tool descriptor is still pending
will pop **someone else's** `cardId` and `personaId`. That is *false* attribution rather than missing
attribution, and false attribution is the more damaging failure — a card gets quality and skill
signal from work that was never done for it.

**Not fixed here, on purpose.** Adding `Workflow` to the `Agent` matcher would also feed a workflow
*script* to `enforce-card-deps.js`, which expects a single-card Agent prompt — a different shape,
with a real risk of spurious blocks. The sound fix is to make the descriptor handoff **keyed** rather
than positional, which is a change to attribution plumbing that deserves its own tests. Present
exposure in this repo is nil, since the standing instruction here is not to use the Workflow tool.
Tracked as **FRW-BL-094**.

**Whenever a new tool that runs commands, writes files, or spawns agents appears in the platform,
add it here and to the matcher.** The audit is only true as of its date.

### A second, sibling defect class: one script under two EVENTS, no discriminator (FRW-BL-113)

Everything above is about a matcher missing a *tool*. This one is different: the `""` (all) row
says an empty matcher "cannot have this bug" — true for the tool-name blind spot, but a script
registered under `""` for **two different hook events** can still misbehave if it does not check
*which event* fired. `.claude/settings.json` registers `session-end.js` under both `SessionEnd`
and `StopFailure`, with identical args and no config-level signal telling the script which one
invoked it.

`StopFailure` fires "when the turn ends due to an API error" (Claude Code hooks reference,
checked 2026-08-12) — a turn-level event, not session termination; the session is expected to
continue. `session-end.js` treated every non-`clear` invocation as a genuine end-of-session and
ran its one-way teardown (complete all running agents, clear `activeProject`) regardless. Live
incident (session `a6cce6c6`, 2026-08-12): a StopFailure run — likely triggered by a `cspell` call
exceeding its tool timeout — executed that teardown while the session kept working for minutes
afterward. The lead agent's own row carries a heartbeat timestamped *after* its recorded
`completedAt`; a reviewer subagent marked `completed` delivered its verdict three minutes later.
Consequences: `registry.activeProject` went null mid-session, which silently zeroed `PROJECT_ID`
in every hook (see below); every live agent's cost/liveness tracking was corrupted; and the
FRW-BL-091 push-receipt guarantee — "each push leaves a receipt" — went silently unmet for the
next push, because its dashboard write is itself gated on `PROJECT_ID`.

**This is the SECOND, INDEPENDENT cause of a symptom FRW-BL-095 already reports — do not close
either card on the other's evidence.** FRW-BL-095 says "long-running subagents are marked completed
while still working ... the dashboard reports zero running agents during a live fan-out" and
attributes it to a **`SubagentStop` propagation gap**, noting that its idle-vs-terminal half has no
finality signal in the payload. FRW-BL-113 produces the *identical* symptom from a completely
different mechanism: a **wholesale mid-session teardown** that completes every running agent row at
once, subagents and lead alike. Both are real. Fixing 095's propagation would not have prevented
this incident, and this fix does not address 095's payload gap. So: when either card is picked up,
check whether the observed row was completed *individually* (095's shape — one subagent, its own
`SubagentStop`) or *in a batch alongside unrelated agents including the lead* (113's shape). The
batch signature is the discriminator.

**The discriminator was available all along and unused.** `hook_event_name` is in the COMMON
input fields sent on *every* hook invocation and equals the literal firing event's name. Fixed by
gating the teardown on `isConfirmedSessionEnd(input.hook_event_name) === 'SessionEnd'` — failing
SAFE (skip teardown) on anything else, including a missing/malformed field, since a skipped
cleanup on a true session end is cheap (next boot's orphan-agent recovery covers it) while a
wrongful teardown mid-session is not recoverable after the fact. Self-tested:
`.claude/hooks/session-end.test.js`.

**A related, narrower finding while diagnosing this:** the push receipt was not *fully* silent —
`post-bash-git.js`'s `log.warn` and its unconditional `stderr.write` both fired, and the local
`VLDR_HOME/logs/{date}.jsonl` line proves it. What silently failed was specifically the
`/api/events` POST that puts the receipt on the dashboard Events page, gated behind
`if (PROJECT_ID)` with no else-branch. That gate now logs loudly when it can't attribute a push,
so the gap itself is visible next time rather than only its absence being noticed later.

**Generalizing, for the next script that gets registered under more than one event:** a shared
matcher across multiple hook EVENTS (not just multiple tool names) is the same risk shape as a
shared matcher across multiple TOOLS — check `hook_event_name` before acting, the same way a
tool-name matcher should be checked before assuming a specific `tool_input` shape.

## The pattern set is shell-shaped, and that matters separately

Widening a matcher does not widen the patterns behind it. When the shell guard reached PowerShell:

- The **git tier worked instantly** — `git` spells the same in every shell. Proven live: both
  `git add -A` (BLOCKED) and `git filter-branch` (DESTRUCTIVE) blocked via the PowerShell tool.
- The **filesystem tier was still dead.** Every pattern was POSIX-shaped. PowerShell's `rm` alias
  rejects a bundled `-rf`, so `rm -rf` is unreachable prose there, while the form a PowerShell
  caller actually writes — `Remove-Item -Recurse -Force` — matched nothing.

Proven by probe rather than inspection: a nested canary tree under `TEMP` was deleted **unguarded**
through the PowerShell tool, minutes after the git tier was proven blocked on that same tool. After
the fix the identical command on an identical tree was blocked and the canary survived.

Now covered (FRW-BL-092): `Remove-Item` with any recurse flag (`-Recurse`/`-Rec`/`-r`, any flag
order), the `Get-ChildItem -Recurse | Remove-Item` pipeline idiom, cmd-style `rd /s` and `del /s`,
`Clear-Content` (in-place truncation) → DESTRUCTIVE tier; `Format-Volume` and `Clear-Disk` →
BLOCKED tier, as the Windows analogue of `rm -rf /`.

Deliberately still uncovered, and why:

- `Start-Process claude -ArgumentList '-p'` — the quote-stripping that stops the guard blocking
  *documentation* about `claude -p` also erases this. `& claude -p` is caught. Chasing every
  indirection reintroduces the FRW-BL-090 false-positive problem for negligible gain.
- `Set-Content` / `Out-File` overwriting an existing file — real data loss, but that is the
  Write/Edit guard family's territory, not the shell guard's.
- `Remove-Item -Force` on a single file — intentionally allowed, symmetric with POSIX `rm -f`,
  which this framework has always permitted.

This guard is defense-in-depth against the routine "oops", not a sandbox. A determined caller gets
past any regex.

## The platform has this bug too — commit with `-F`, not `-m`

Claude Code's **own** PowerShell safety check has the FRW-BL-090 shape. Committing the FRW-BL-092
fix was refused with:

```
Remove-Item on system path '/s' is blocked. This path is protected from removal.
```

Nothing in this framework produced that. The platform scanned the `git commit -m` argument, found
prose *documenting* cmd-style delete flags, and read it as a live delete targeting `/s`. Writing
about a forbidden command is not running one — the exact distinction FRW-BL-090 fixed one layer
down, in our own guard.

Not fixable from here. **Workaround: write the message to a file and use `git commit -F <file>`**,
so the text never appears on the shell command line. Reach for `-F` immediately when a commit
message needs to quote destructive syntax, rather than re-diagnosing this. (PowerShell has no
heredoc, so `git commit -F -` with a `<<EOF` body is a parse error here — use a real file.)

## Known limit when verifying the approval path

`VLDR_ALLOW_DESTRUCTIVE=1` **cannot be exercised from inside a tool call.** The hook runs as a
separate process that inherits the *harness* environment, so `$env:VLDR_ALLOW_DESTRUCTIVE = '1'`
set inside a command never reaches it. Verify the approval-receipt branch by driving the hook with
synthetic stdin, and treat that as proof of the branch's logic only — never of its registration.

## Probe recipe

Cheap, and the only honest proof for a registration change. Pick commands that are **safe when the
guard is absent**, because that is the case you are testing for:

| Probe | Why it is safe unguarded |
|---|---|
| `git add -A` | worst case stages files; undone with `git restore --staged` |
| `git filter-branch` (no args) | errors out asking for a ref |
| `Remove-Item -Recurse -Force <your own canary dir>` | destroys only a throwaway tree you just created |

Never probe with `rm -rf /`, `git push --force`, or `claude -p`: if the guard is missing, the probe
is the disaster.

Run each through **both** shell tools. A block via one tool proves nothing about the other — that
is the entire lesson of this card.
