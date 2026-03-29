---
name: "Caching Strategies"
description: "Cache layers, TTL design, invalidation patterns, and when not to cache"
domain: "engineering"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "cache"
  - "caching"
  - "redis"
  - "ttl"
  - "invalidation"
  - "stale"
  - "memoize"
roles:
  - "developer"
  - "architect"
---

## Context
Apply when designing data fetching pipelines, API responses, or client-side data management.
Caching is a performance multiplier but introduces correctness risks if invalidation is wrong.

## Patterns

**Cache layers (outer to inner):**
1. CDN / edge cache — static assets, public API responses
2. HTTP cache headers — `Cache-Control`, `ETag`, `Last-Modified`
3. Application cache — Redis, in-process Map
4. Database query cache — most DBs handle this internally

**TTL design — match to data freshness requirements:**
- Static config: 1 hour – 24 hours
- User profiles: 5 – 60 minutes
- Real-time data: no cache or <10 seconds
- Computed aggregates: 1 – 15 minutes

**Cache-aside pattern (most common):**
```typescript
async function getCachedSkill(id: string): Promise<Skill> {
  const cached = await redis.get(`skill:${id}`);
  if (cached) return JSON.parse(cached);
  const skill = await db.getSkill(id);
  await redis.setex(`skill:${id}`, 300, JSON.stringify(skill)); // 5 min TTL
  return skill;
}
```

**Invalidation on write:**
```typescript
async function updateSkill(id: string, data: UpdateSkillInput) {
  await db.updateSkill(id, data);
  await redis.del(`skill:${id}`);          // invalidate specific key
  await redis.del('skills:list');           // invalidate list caches
}
```

**HTTP cache headers:**
```
Cache-Control: max-age=300, stale-while-revalidate=60
ETag: "abc123"
```

## Examples

```typescript
// In-process cache with TTL (no Redis dependency)
class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  set(key: string, value: T, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }
}
```

## Anti-Patterns

- **Caching without invalidation** — stale data is worse than slow data for correctness-critical paths
- **Caching unique per-user data globally** — user A seeing user B's data is a security bug
- **Cache stampede** — many concurrent misses hitting the origin; use locks or probabilistic early expiry
- **Caching errors** — if the upstream fails, cache the success result only
- **Over-caching** — adds complexity; only cache what profiling shows is a bottleneck
