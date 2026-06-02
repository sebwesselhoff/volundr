# Machine Constraints

Auto-detected environment info shared across all projects. Refreshed if older than 7 days.

**Last refresh:** 2026-05-15 (CARD-000 for co-azure-audit)

---

## Runtime

- **OS:** Windows 11 Enterprise 10.0.26200
- **Shell:** PowerShell 7+ (pwsh) primary; Bash available via Bash tool
- **Node.js:** v24.4.1
- **npm:** 11.4.2
- **TypeScript:** 5.9.3 (global via npx)
- **Claude Code CLI:** 2.1.161 (min supported **2.1.120** — see `framework/cc-version-baseline.md`)

## Azure tooling

- **Azure CLI:** 2.76.0 (2 updates available; non-blocking)
- **GitHub Copilot CLI:** 1.0.48
- On Windows: `az` resolves to `az.cmd`; `copilot` resolves to `copilot.cmd`. Subprocess
  spawners must use the `.cmd` form.

## Git

- **User:** Sebastian Wesselhoff <sebastian.wesselhoff@contica.se>
- **Long path support:** required on Windows for deep `node_modules` trees;
  set `git config --global core.longpaths true` if not already.

## Constraints

- **Path separators:** Windows uses `\`. TS/Node code must use `path.join`, never literal
  separators.
- **Per-process file handle limits:** Windows defaults are conservative; large fan-out
  collectors should reuse handles rather than open-per-resource.
- **Spawn quoting:** `az.cmd`/`copilot.cmd` invocations under `child_process.spawn` need
  the Windows-specific quoting that `co-azure-audit/server/src/collectors/azure/runAz.ts`
  already implements.

## Disk paths (per-project)

| Path | Use |
|---|---|
| `C:\Users\SebastianWesselhoff\source\co-azure-audit` | Active project (target) |
| `C:\Users\SebastianWesselhoff\source\Holmen` | Read-only audit evidence corpus |
| `C:\Users\SebastianWesselhoff\source\Holmen-Repo` | Read-only customer source |
| `C:\Users\SebastianWesselhoff\source\repos\internal\clear` | Read-only reuse source (CLEAR) |
| `C:\Users\SebastianWesselhoff\source\repos\internal\Ai-Bixray` | Read-only inspiration (BixRay) |
| `C:\Users\SebastianWesselhoff\.volundr` | VLDR_HOME — per-project state |

## Verified builds (CARD-000)

- `co-azure-audit`: `npm run build` exit 0; web bundle 264 KB JS / 14 KB CSS / 999 ms vite build.
  No global `tsc` entry — per-workspace builds via `scripts/build.mjs`.
- No tests yet — vitest scaffold lands in Slice 1.
