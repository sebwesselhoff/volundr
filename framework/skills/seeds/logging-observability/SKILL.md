---
name: "Logging & Observability"
description: "Structured logging, log levels, tracing, metrics, and what not to log"
domain: "engineering"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "logging"
  - "observability"
  - "structured log"
  - "metrics"
  - "tracing"
  - "log level"
  - "monitoring"
roles:
  - "developer"
  - "devops-engineer"
---

## Context
Apply when adding logging to services, setting up monitoring, or reviewing observability coverage.
Good observability is what allows you to diagnose production issues without guessing.

## Patterns

**Structured logging — log objects, not strings:**
```typescript
// Good
logger.info({ event: 'card.created', cardId, projectId, userId }, 'Card created');

// Bad — hard to query
console.log(`Card ${cardId} created by ${userId} in project ${projectId}`);
```

**Log levels — use the right level:**
- `debug` — fine-grained detail for development
- `info` — notable lifecycle events (startup, shutdown, key actions)
- `warn` — unexpected but recoverable situations
- `error` — failures that need attention
- `fatal` — service cannot continue

**Include correlation IDs** — attach a `requestId` to every log in a request lifecycle.

**Metrics to capture:**
- Request latency (p50, p95, p99)
- Error rate by route
- Queue depth (for async workers)
- DB query time

**Avoid noisy logs** — do not log on every tick or for expected empty results.

## Examples

```typescript
// Express request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});
```

## Anti-Patterns

- **Logging sensitive data** — no passwords, tokens, PII, or secrets in logs
- **`console.log` in production** — use a structured logger (pino, winston)
- **Logging every DB row** — summarize, don't dump
- **Error logs without stack traces** — include `err.stack` for debugging
- **No log level filtering** — debug logs in production flood your logging bill
