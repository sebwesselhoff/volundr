---
name: "Performance Optimization"
description: "Profiling before optimizing, memoization, pagination, lazy loading, and avoiding premature optimization"
domain: "engineering"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "performance"
  - "optimization"
  - "slow"
  - "latency"
  - "memory"
  - "cpu"
  - "profiling"
  - "bottleneck"
roles:
  - "developer"
  - "architect"
---

## Context
Apply when a system is measurably slow or when designing data-intensive paths. Do not apply
prematurely — optimize only after identifying actual bottlenecks via profiling.

## Patterns

**Measure first — profile, then optimize:**
1. Reproduce the slowness with a benchmark or load test
2. Profile to find the actual bottleneck (it's rarely where you think)
3. Fix the root cause, measure improvement, commit only if meaningful

**Memoization for pure expensive functions:**
```typescript
const memoize = <T>(fn: (...args: string[]) => T) => {
  const cache = new Map<string, T>();
  return (...args: string[]) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key)!;
  };
};
```

**Pagination — never return unbounded lists:**
```typescript
// Always: limit + offset or cursor-based
const items = await db.select().from(table)
  .limit(req.query.limit ?? 50)
  .offset(req.query.offset ?? 0)
  .all();
```

**Database indexes on hot query paths** — profile slow queries with `EXPLAIN QUERY PLAN`.

**Lazy loading** — defer expensive initialization until first use.

## Examples

```typescript
// Cache DB lookup for the lifetime of a request
class RequestCache {
  private store = new Map<string, unknown>();
  async get<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    if (!this.store.has(key)) this.store.set(key, await fetch());
    return this.store.get(key) as T;
  }
}
```

## Anti-Patterns

- **Optimizing without profiling** — you will fix the wrong thing
- **Premature memoization** — adds complexity and memory pressure for rarely-called functions
- **Fetching all rows to filter in JavaScript** — filter in SQL
- **Blocking the event loop** — no synchronous heavy computation on the main thread
- **Caching mutable data without invalidation** — stale cache is worse than no cache
