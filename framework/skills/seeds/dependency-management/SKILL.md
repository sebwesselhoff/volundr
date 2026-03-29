---
name: "Dependency Management"
description: "Package versioning, lockfiles, security audits, and keeping dependencies up-to-date"
domain: "engineering"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "dependency"
  - "npm"
  - "package"
  - "lockfile"
  - "audit"
  - "version"
  - "semver"
  - "upgrade"
roles:
  - "developer"
  - "devops-engineer"
---

## Context
Apply when adding packages, reviewing `package.json`, or maintaining a codebase over time.
Unmanaged dependencies accumulate security debt and make upgrades painful.

## Patterns

**Commit lockfiles** — `package-lock.json` or `yarn.lock` ensures reproducible installs.
Never add them to `.gitignore`.

**Semver ranges — be intentional:**
- `"^1.2.3"` — accept minor and patch updates (safe for most libraries)
- `"~1.2.3"` — accept patch updates only (stricter)
- `"1.2.3"` — exact pin (use for critical infrastructure; creates upgrade friction)

**Separate dev from production dependencies:**
```bash
npm install --save express          # runtime dep
npm install --save-dev vitest       # dev/test dep
```

**Regular audit:**
```bash
npm audit                           # check for known vulnerabilities
npm audit fix                       # auto-fix safe upgrades
```

**`npm ci` in CI** — uses lockfile exactly; fails if lockfile is out of sync with `package.json`.

**Check bundle impact before adding:** does this package justify its weight? Check bundlephobia.

**Peer dependencies** — when writing libraries, declare shared packages as `peerDependencies`
not `dependencies` to avoid version duplication.

## Examples

```json
// package.json — clear separation
{
  "dependencies": {
    "express": "^4.21.2",
    "better-sqlite3": "^11.8.1",
    "drizzle-orm": "^0.38.3"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.7.3",
    "@types/node": "^22.0.0"
  }
}
```

## Anti-Patterns

- **`npm install` without `--save` or `--save-dev`** — dependency won't appear in package.json
- **Ignoring `npm audit` warnings** — high/critical vulnerabilities need prompt attention
- **Wildcard versions `*` or `x`** — non-deterministic builds, unexpected breaking changes
- **Committing `node_modules/`** — this is what lockfiles and `npm ci` are for
- **Adding packages for trivial utilities** — one-liners don't need a dependency (left-pad lesson)
