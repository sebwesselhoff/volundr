# Machine Constraints

Auto-detected environment info shared across all projects. Refreshed if older than 7 days.

**Last refresh:** 2026-08-26 (boot for volundr-meta)

---

## Runtime

- **OS:** Windows 11 Enterprise 10.0.26200
- **Shell:** PowerShell 7+ (pwsh) primary; Bash available via Bash tool
- **Node.js:** v24.4.1
- **npm:** 11.4.2
- **TypeScript:** per-project devDependency (no global tsc; run via the project's `npx tsc`/`npm` scripts)
- **Claude Code CLI:** 2.1.246 (min supported **2.1.219** — see `framework/cc-version-baseline.md`)

## Azure tooling

- **Azure CLI:** 2.87.0
- **GitHub Copilot CLI:** 1.0.80
- On Windows: `az` resolves to `az.cmd`; `copilot` resolves to `copilot.cmd`. Subprocess
  spawners must use the `.cmd` form.

## Git

- **Version:** git 2.54.0.windows.1
- **User:** Sebastian Wesselhoff <sebastian.wesselhoff@contica.se>
- **Long path support:** required on Windows for deep `node_modules` trees;
  **currently NOT set** on this machine (`git config --global core.longpaths` is empty) — set it before
  any deep `node_modules` checkout or worktree operation that could hit MAX_PATH.

## Constraints

- **Path separators:** Windows uses `\`. TS/Node code must use `path.join`, never literal
  separators.
- **Per-process file handle limits:** Windows defaults are conservative; large fan-out
  collectors should reuse handles rather than open-per-resource.
- **Spawn quoting:** `az.cmd`/`copilot.cmd` invocations under `child_process.spawn` need
  the Windows-specific quoting that `co-azure-audit/server/src/collectors/azure/runAz.ts`
  already implements.
- **NEVER invoke `npm`/`npx` through PowerShell's call operator.** Call them **bare**
  (`npx -y cspell@8 --config cspell.json file.md`), not `& npx …` and not
  `$out = & npx … 2>&1`. PowerShell resolves `npm`/`npx` to the `.ps1` shim, whose
  `-Command` branch rebuilds its arguments by slicing `InvocationName.Length` characters off a
  *reconstructed* command line (`npx.ps1:43`). The `&` operator shifts that line, so the slice
  eats real characters: `& npm config get prefix` reaches npm as `pm config get prefix` →
  `Unknown command: "pm"`, and `& npx <anything>` reaches npx as `px <anything>` →
  `npm error could not determine executable to run`.
  **This misreads as "npx is broken on this machine" and it is not** — bare invocation works
  perfectly (`npx --version` → 11.4.2). It cost a false gate-suite failure once: cspell was
  recorded as un-runnable locally and a word was added to `cspell.json` as insurance that the
  stock dictionaries already knew. Measured matrix — the `&` operator is the *only*
  discriminator, so capturing output is fine as long as you drop it:

  | Form | Result |
  |---|---|
  | `npx --version` | `11.4.2` |
  | `$a = npx --version` | `11.4.2` |
  | `$c = (npx --version)` | `11.4.2` |
  | `$b = & npx --version 2>&1` | `could not determine executable to run` |

  Local binaries are immune regardless of invocation form, since they skip the shim:
  `.\node_modules\.bin\turbo.cmd build`.
- **Run cspell locally on CHANGED files only — that is what CI does.** `cspell-action@v8`
  leaves `incremental_files_only` at its default `'true'` (verified against the action
  definition), so the CI Docs job checks only files in the push, never the whole tree.
  A repo-wide `cspell "**/*.md"` reports ~20 unknown words in files nobody touched
  (`docs/superpowers/specs/…`, `framework/research/…`, `framework/telemetry.md`) — those are
  **pre-existing and not failing CI**. Do not "fix" them as part of an unrelated card, and do
  not read them as a broken gate. Match CI with the changed set:
  `npx -y cspell@8 --config cspell.json --no-progress $(git diff --name-only HEAD~1 -- '*.md')`.

## Disk paths (per-project)

| Path | Use |
|---|---|
| `C:\Users\SebastianWesselhoff\source\repos\internal\Test\ATA - Automated Testing Applicator` | Active project (target — ata-mcp) |
| `C:\Users\SebastianWesselhoff\source\co-azure-audit` | Prior project (co-azure-audit) |
| `C:\Users\SebastianWesselhoff\source\Holmen` | Read-only audit evidence corpus |
| `C:\Users\SebastianWesselhoff\source\Holmen-Repo` | Read-only customer source |
| `C:\Users\SebastianWesselhoff\source\repos\internal\clear` | Read-only reuse source (CLEAR) |
| `C:\Users\SebastianWesselhoff\source\repos\internal\Ai-Bixray` | Read-only inspiration (BixRay) |
| `C:\Users\SebastianWesselhoff\.volundr` | VLDR_HOME — per-project state |

## Verified builds (CARD-000)

- `co-azure-audit`: `npm run build` exit 0; web bundle 264 KB JS / 14 KB CSS / 999 ms vite build.
  No global `tsc` entry — per-workspace builds via `scripts/build.mjs`.
- No tests yet — vitest scaffold lands in Slice 1.
