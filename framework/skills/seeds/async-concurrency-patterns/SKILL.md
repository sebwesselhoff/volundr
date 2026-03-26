---
name: "Async & Concurrency Patterns"
description: "Promise patterns, async/await pitfalls, parallel execution, and race condition avoidance"
domain: "engineering"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "async"
  - "await"
  - "promise"
  - "concurrent"
  - "parallel"
  - "race condition"
  - "setTimeout"
roles:
  - "developer"
  - "reviewer"
---

## Context
Apply when writing async code, parallel operations, or anything involving shared mutable state across
async boundaries. Concurrency bugs are subtle and hard to reproduce in tests.

## Patterns

**Run independent async operations in parallel:**
```typescript
// Sequential (slow): each awaits the previous
const user = await getUser(id);
const perms = await getPermissions(id);

// Parallel (fast): both start simultaneously
const [user, perms] = await Promise.all([getUser(id), getPermissions(id)]);
```

**`Promise.allSettled` when partial failure is acceptable:**
```typescript
const results = await Promise.allSettled(items.map(process));
const succeeded = results.filter(r => r.status === 'fulfilled');
```

**Avoid `async` functions that don't `await` anything** — they add overhead with no benefit.

**Mutex for shared mutable state:**
```typescript
// Simple in-memory lock
let lock = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn);
  lock = next.catch(() => {});
  return next;
}
```

**Timeout wrapper:**
```typescript
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('Timeout')), ms))]);
}
```

## Examples

```typescript
// Good: fan-out then collect
const skillIds = ['sk-001', 'sk-002', 'sk-003'];
const skills = await Promise.all(skillIds.map(id => vldr.skills.get(id)));
```

## Anti-Patterns

- **Sequential awaits in a loop** — use `Promise.all` with `.map` instead
- **Unhandled promise rejections** — always `.catch()` or use `await` in try/catch
- **`async` event handlers without try/catch** — unhandled rejections crash Node
- **Modifying shared array/object from concurrent promises** — use immutable patterns or collect results
- **Long polling with `setTimeout` in a loop** — prefer WebSockets or SSE for push updates
