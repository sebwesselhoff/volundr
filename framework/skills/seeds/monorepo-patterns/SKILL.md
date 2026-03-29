---
name: "Monorepo Patterns"
description: "Turborepo, workspace dependencies, shared packages, build caching, and task pipelines"
domain: "devops"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "monorepo"
  - "turborepo"
  - "workspace"
  - "turbo"
  - "packages"
  - "shared"
  - "build pipeline"
roles:
  - "developer"
  - "devops-engineer"
  - "architect"
---

## Context
Apply when working in a monorepo (e.g., this project: `dashboard/packages/api`, `packages/db`,
`packages/sdk`, `packages/shared`). Monorepos share code across packages while keeping clear
boundaries; Turborepo adds build caching and pipeline orchestration.

## Patterns

**Package naming with scopes:** `@vldr/api`, `@vldr/db`, `@vldr/sdk`, `@vldr/shared`.
Scoped names prevent conflicts and make imports self-documenting.

**Dependency flow — one direction:**
```
api → db, shared
sdk → shared
web → sdk, shared
db  → shared
```
Circular package dependencies (`api → sdk → api`) break builds and indicate a design problem.

**Turbo pipeline — declare task dependencies:**
```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],  // build dependencies first
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**`^build` means "build all dependencies first"** — packages build in correct order automatically.

**Workspace protocol for local packages:**
```json
// api/package.json
{ "dependencies": { "@vldr/db": "workspace:*" } }
```

**Shared tsconfig:**
```json
// packages/shared/tsconfig.json is the base; others extend it
{ "extends": "../../tsconfig.json" }
```

## Examples

```bash
# Run dev for all packages in parallel
turbo dev

# Build only the api package and its dependencies
turbo build --filter=@vldr/api

# Run tests only for packages changed since last commit
turbo test --filter='[HEAD^1]'
```

## Anti-Patterns

- **Cross-package relative imports** — `import { x } from '../../sdk/src'` instead of `@vldr/sdk`
- **Circular package dependencies** — restructure or extract shared code to a new package
- **Putting everything in one package** — defeats the purpose; enforce boundaries
- **Not declaring `outputs` in turbo.json** — Turborepo can't cache without knowing what to save
- **Committing `.turbo/` cache** — it's machine-local; add to `.gitignore`
