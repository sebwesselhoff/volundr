# Hook Coverage — which tools each guard actually guards

**Origin: FRW-BL-092.** Every shell safety guard in this framework was inoperative for the
PowerShell tool — the primary shell on the Windows dev machine — for an unknown number of sessions.
Nothing was wrong with the guards. They were registered with `matcher: "Bash"`, and PowerShell is a
separate tool name.

This document exists so that fact is looked up rather than rediscovered.

> **There is now a linter for this whole class — run it instead of re-reasoning (FRW-BL-107).**
> `node scripts/hook-config-audit.mjs` audits the WIRING rather than the handlers: matcher tool names
> against a versioned registry, capability classes with an unguarded sibling, hooks reading input
> fields their matched tools never send, matcher parity across both manifests, and one script
> registered under two hook *events* with no `hook_event_name` discriminator. It runs in CI and is
> self-tested against the real pre-fix configs of FRW-BL-092, FRW-BL-093 and FRW-BL-113 — it is
> proven to catch the three defects that actually shipped here, not just invented fixtures.
>
> The tool set it checks against lives in `framework/platform-tools.json`, stamped with the CLI
> version it was verified on. **When the platform gains a tool, add it there** — the auditor warns
> (never blocks) on a name it does not recognise, precisely so a platform update cannot wedge the
> gate suite, but a warning nobody reads is how the FRW-BL-092 gap survived in the first place.
> An accepted gap needs a waiver **naming a card**; card-less waivers are ignored, and every applied
> waiver is echoed in the output so an accepted gap stays visible.

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
| `Agent` | `pre-agent-tool` (card/persona descriptor queue), `enforce-card-deps` | Agent | **`Workflow`** | **RESOLVED — waiver retained, reason narrowed.** FRW-BL-094 |
| `Skill` | `enforce-tool-priority` | Skill | — | covered |
| `""` (all) | SessionStart/SubagentStart/SubagentStop/TaskCompleted/TeammateIdle/Stop/SessionEnd/PreCompact/PostCompact/WorktreeCreate/WorktreeRemove/ConfigChange/InstructionsLoaded/PostToolUseFailure/StopFailure | everything | — | empty matcher cannot have this bug |

`Monitor` needed **no code change**: its input field is `command`, the same field
`enforce-bash-rules` already reads. `NotebookEdit` did need one — it passes `notebook_path`, while
`enforce-worktree-path-write` read only `tool_input.file_path`, so adding it to the matcher alone
would have registered a hook that inspects `undefined` and passes everything. **Fixed in
FRW-BL-093**: `resolveWriteTarget()` resolves whichever field the tool sent and names it back in the
remediation message, because telling a NotebookEdit caller to correct their "file_path" is a dead
end. The code landed **before** the matcher, in that order, deliberately.

### The `Workflow` attribution gap — RESOLVED (FRW-BL-094)

*What follows describes the defect as it was, then the fix. The description is kept because the
reasoning that rejected the obvious fix is still the reasoning that keeps the matcher waiver.*

`PreToolUse: Agent` runs `pre-agent-tool.js`, which parses `# CARD-XX-NNN:` and `personaId:` out of
an Agent prompt and writes them to a FIFO descriptor queue; `agent-start.js` **used to pop** that
queue positionally and stamp the dashboard agents row. The `Workflow` tool spawns subagents
**without invoking the Agent tool**, so nothing is ever written to the queue for them. `SubagentStart`
still fires (its matcher is `""`), so the row is created — just unattributed. Consequence:
workflow-spawned agents carry no `cardId`/`personaId`, which quietly weakens FRW-002 persona skill
extraction (it weights confidence on those rows), and `enforce-card-deps.js` never runs for them.

**Worse, and the real reason this needs its own card:** the pop is a *blind* FIFO, not keyed to the
starting agent. A workflow agent that starts while a genuine Agent-tool descriptor is still pending
will pop **someone else's** `cardId` and `personaId`. That is *false* attribution rather than missing
attribution, and false attribution is the more damaging failure — a card gets quality and skill
signal from work that was never done for it.

**RESOLVED in FRW-BL-094 — but not by widening the matcher.** Adding `Workflow` to the `Agent`
matcher was always the wrong move: it would feed a workflow *script* to `enforce-card-deps.js`,
which expects a single-card Agent prompt, and it would not have touched the positional pop that was
the actual bug. **That reasoning still holds, so the matcher waiver stays** — what changed is the
plumbing behind it.

The handoff is now **keyed**. `readQueue()` lists live descriptors and `chooseDescriptor()` takes the
one belonging to the starting agent, or **takes nothing**: a name match first, then a *unique* type
match, and otherwise no descriptor at all. Two indistinguishable pending entries can no longer be
resolved by age, so nothing can inherit another spawn's `cardId`. Every unmatched case logs
`descriptor_unmatched` with its reason, because an unattributed row that is *silently* unattributed
is indistinguishable from an agent that genuinely had no card.

Workflow subagents are therefore **excluded by construction rather than by a special case**: nothing
is queued for them (`PreToolUse` matches `Agent`, not `Workflow`), so no name and no unique type can
match, and they register unattributed. Asserted in the self-test, not assumed.

**Measured, not inferred.** A probe spawning two NAMED subagents in one message with different card
headers found attribution did **not** cross — the name path already held. The real exposure was the
UNNAMED path, which is what the fail-closed rule closes.

**One more thing the same investigation turned up:** the agents ROW carried its `cardId` while the
`agent_spawned` EVENT did not. `procedural-order.mjs` filters events by `cardId`, so its
anti-stub-before-blind-review rule reported *not-applicable* instead of checking — an attribution
gap in the event stream had silently disabled a gate that reads the event stream. Both event writes
now carry `cardId` and `agentId`.

### Three attribution defects that share one symptom — keep them apart (FRW-BL-114)

All three produce a dashboard `agents` row with a null `cardId`, which is why they look like one
bug and must not be merged into one. They have different causes and different fixes:

| Card | What is wrong | The row represents |
|---|---|---|
| **FRW-BL-094** | The descriptor pop is positional, so a spawn can claim **someone else's** `cardId`/`personaId` | a real agent, **mis**-attributed |
| **FRW-BL-095** | `SubagentStop` writes terminal status on every idle/wake cycle, so a working agent reads `completed` | a real agent, wrongly **completed** |
| **FRW-BL-114** | Unclassifiable events were typed `developer` | **no agent at all** — there is nothing to attribute correctly or complete late |

FRW-BL-114 is the one with no agent behind it. Fixing 094's keying would not remove those rows,
and fixing 095's lifecycle would not either.

### `status` is lifecycle; `liveness` is aliveness (FRW-BL-095)

`SubagentStop` fires **once per idle/wake cycle**, not once at the end. `agent-stop.js` knew that —
it accumulated tokens per cycle for exactly that reason — and still wrote `status: 'completed'` on
every one of them. So a working agent read `completed` between turns: `?status=running` undercounted
a live fan-out (one row shown during a six-agent wave), and `stalled-scan` could not tell
idle-but-alive from finished.

A payload probe settled whether a condition could fix it. The `SubagentStop` payload carries
`agent_id`, `agent_transcript_path`, `agent_type`, `background_tasks`, `cwd`, `hook_event_name`,
`last_assistant_message`, `permission_mode`, `prompt_id`, `session_crons`, `session_id`,
`stop_hook_active`, `transcript_path` — and **no finality signal**. `stop_hook_active` is hook
a signal of whether a stop hook already blocked this turn, not of whether the agent is finished; reading it as completion would have been a plausible and wrong guess.

So the split is:

| Field | Means | Written by |
|---|---|---|
| `status` | lifecycle — has this agent been closed out? | `session-end.js`, and the boot orphan sweep |
| `liveness` (computed) | aliveness — working / idle / stalled | derived by the API from the agent's newest event timestamp (FRW-BL-063) |

`agent-stop.js` now writes tokens and model only, and emits **`agent_yielded`** carrying `agentId`
and that cycle's **marginal** tokens. Both halves matter: the `agentId` is what feeds the liveness
signal, and marginal-not-cumulative is what stops a cost sum over the event stream double-counting
(one observed agent reported 1 286 962 then 1 615 166 tokens, where the second cycle's real spend
was ~329k). The row was right all along; the events were not.

**The trade, made deliberately.** This under-completes — a finished agent reads `running` until
session end — where the old code over-completed. Under-completion is bounded and already swept at
both ends (`session-end.js` closes every running agent; `session-start.js` cleans orphans from
crashes). Over-completion gave wrong answers for the whole session. A finished-but-unswept agent
drifting to `stalled` is a *correct* signal, not noise: it means something finished and nothing
closed it.

Note this only became usable once `agent_spawned` carried an `agentId` (FRW-BL-094) — before that,
spawn events fed the liveness signal nothing at all.

### Telling a phantom row from a real spawn

The observed phantom signature, from project `snow-addendum` (session `17a84942`, 2026-08-26), where
a session that spawned **zero** subagents registered 150 `developer` rows:

- `startedAt === completedAt` to the millisecond — zero duration
- `promptTokens === 0 && completionTokens === 0`
- `cardId`, `personaId`, `parentAgentId` and `sessionId` all null
- `detail` is a bare `a`-prefixed hex id (e.g. `a7322189b24dcbc4b`) rather than a name or description

That last field is the tell. It is `input.agent_id`, which `agent-start.js` falls back to when
`input.agent_type` is **empty** — so these are `SubagentStart` events arriving with no agent type at
all. A real spawn carries either a descriptive name or a description from the Agent tool.

```bash
# Phantom candidates for one project — near-zero duration, zero tokens, no parent, id-shaped detail.
curl -s "http://localhost:3141/api/projects/<id>/agents" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  // MUST normalise before comparing: startedAt is the dashboard's 'YYYY-MM-DD HH:MM:SS' (UTC, no
  // marker) while completedAt is an ISO string from an API write. Comparing them as strings never
  // matches and the query silently reports zero — the same trap FRW-BL-103 hit in procedural-order.
  const ms = (t) => Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\$/.test(String(t||''))
    ? String(t).replace(' ', 'T') + 'Z' : t);
  const rows = JSON.parse(d).filter(a => {
    const dur = ms(a.completedAt) - ms(a.startedAt);
    return Number.isFinite(dur) && dur >= 0 && dur < 1000        // sub-second lifetime
      && !a.promptTokens && !a.completionTokens
      && !a.parentAgentId && /^a[0-9a-f]{8,}\$/.test(String(a.detail || ''));
  });
  console.log(rows.length + ' phantom candidate(s)');
  rows.forEach(r => console.log('  ' + r.id + '  ' + r.startedAt + '  ' + r.detail));
});"
```

Duration is compared as a **sub-second window**, not as equality. The two columns are written by
different code paths at slightly different instants, so exact equality is the wrong test — and it is
the test that made the first version of this query report zero against a project that demonstrably
has them.

**Read it as candidates, not a verdict.** A genuine subagent that fails instantly would share the
zero-duration and zero-token columns; what separates a phantom is the id-shaped `detail` together
with the null parent. Cost already recorded against phantom rows cannot be recomputed from here —
this query identifies them so a human can decide, which is the whole of what FRW-BL-114 scoped.

**Relabelling is not enough — the row must not be written.** Typing a phantom `unknown` stops it
polluting persona skill confidence, but it still inflates the agent count and the cost model, and a
session that spawned nothing still would not register "exactly one row". `resolveRegistration()`
therefore declines to write at all when a `SubagentStart` firing carries **no identity of any kind**:
no `agent_type`, no queued descriptor, and no resolvable parent.

The test is deliberately narrow, because suppressing a *real* spawn would lose tracking and be a
worse defect than a mislabelled row. A genuine spawn always has at least one of those three — a
name, a description from the Agent tool, or a parent it was spawned from. **An `agent_id` is not
identity**: it is generated per firing, and it was the entire content of every phantom row's
`detail`. Every suppression is logged (`registration_suppressed`) with its reason, because a silent
decline would be its own version of this bug — an invisible policy nobody can audit.

**The classifier fix** is in `inferAgentType`: its two fallbacks returned `developer`, so `developer` was the
type of everything it could not classify — and `extractSkills` weights persona skill confidence on
exactly those rows. They now return `unknown`, and a generic `subagent_type` (`general-purpose`,
`Explore`, `Plan`, `workflow-subagent`) no longer overrides the agent's own name. That second half
was found live in **this** repo, not on snow-addendum: blind reviewers named `reviewer-frw-bl-NNN`
were being registered as `developer`, because the type was taken from `general-purpose` rather than
from the name that actually identified them.

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
