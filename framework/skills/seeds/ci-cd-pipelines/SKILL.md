---
name: "CI/CD Pipeline Patterns"
description: "GitHub Actions, pipeline stages, caching, secrets management, and deployment gates"
domain: "devops"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "ci"
  - "cd"
  - "pipeline"
  - "github actions"
  - "workflow"
  - "deploy"
  - "continuous integration"
roles:
  - "devops-engineer"
  - "developer"
---

## Context
Apply when writing or reviewing CI/CD pipeline configuration. Well-designed pipelines enforce quality
gates, run fast via caching, and keep secrets out of logs.

## Patterns

**Stage ordering — fail fast:**
1. Lint / type-check (cheapest, catches most typos)
2. Unit tests
3. Build
4. Integration tests
5. Deploy (only on branch or tag match)

**Cache dependencies — save minutes per run:**
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}
```

**Secrets via environment, never hardcoded:**
```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
```

**Matrix builds for cross-version testing:**
```yaml
strategy:
  matrix:
    node: [20, 22]
```

**Deployment gates:**
- Only deploy from `main` or tagged releases
- Require passing status checks before merge
- Use environments with required reviewers for production

## Examples

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint && npm run typecheck
      - run: npm test
```

## Anti-Patterns

- **Secrets in workflow files or logs** — always use `${{ secrets.* }}`
- **No caching** — installing 500MB of node_modules on every run wastes 2+ minutes
- **Deploy on every push to every branch** — gate deploys behind branch conditions
- **Skipping tests on hotfix branches** — tests exist for a reason; run them always
- **Giant monolithic jobs** — split into parallel jobs where possible
