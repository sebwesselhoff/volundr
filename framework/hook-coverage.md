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
| `Write\|Edit` | `enforce-worktree-path-write` | Write, Edit | **`NotebookEdit`** | **GAP** — needs code, not just a matcher (below). FRW-BL-093 |
| `Agent` | `pre-agent-tool` (card/persona descriptor queue), `enforce-card-deps` | Agent | **`Workflow`** | **GAP** — workflow subagents get no card/persona attribution and bypass dep enforcement. FRW-BL-093 |
| `Skill` | `enforce-tool-priority` | Skill | — | covered |
| `""` (all) | SessionStart/SubagentStart/SubagentStop/TaskCompleted/TeammateIdle/Stop/SessionEnd/PreCompact/PostCompact/WorktreeCreate/WorktreeRemove/ConfigChange/InstructionsLoaded/PostToolUseFailure/StopFailure | everything | — | empty matcher cannot have this bug |

`Monitor` needed **no code change**: its input field is `command`, the same field
`enforce-bash-rules` already reads. `NotebookEdit` does need one — it passes `notebook_path`, while
`enforce-worktree-path-write` reads `tool_input.file_path`, so adding it to the matcher alone would
register a hook that inspects `undefined` and passes everything.

**Whenever a new tool that runs commands, writes files, or spawns agents appears in the platform,
add it here and to the matcher.** The audit is only true as of its date.

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
