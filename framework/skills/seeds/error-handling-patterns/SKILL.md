---
name: "Error Handling Patterns"
description: "Typed errors, error boundaries, propagation strategies, and consistent user-facing error messages"
domain: "engineering"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "error handling"
  - "exception"
  - "try catch"
  - "error boundary"
  - "ApiError"
  - "throw"
roles:
  - "developer"
  - "reviewer"
---

## Context
Apply when writing functions that can fail, designing API error responses, or reviewing error
propagation. Inconsistent error handling is a top source of hard-to-debug production issues.

## Patterns

**Custom typed error classes:**
```typescript
export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
```

**Let errors propagate to a central handler** — avoid try/catch at every call site:
```typescript
// Express: global error middleware handles all uncaught errors
app.use((err: unknown, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

**Distinguish operational vs programming errors:**
- Operational: user not found, network timeout — handle gracefully, return 4xx
- Programming: null dereference, type mismatch — log, return 500, alert

**Use `Result` types for expected failures (functional style):**
```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```

## Examples

```typescript
// Good: throw typed error, let middleware handle it
router.get('/users/:id', async (req, res) => {
  const user = await db.findUser(req.params.id);
  if (!user) throw new ApiError(404, `User '${req.params.id}' not found`);
  res.json(user);
});
```

## Anti-Patterns

- **Swallowing errors silently** — `catch (err) {}` hides bugs
- **Returning `null` for all error cases** — callers can't distinguish "not found" from "server error"
- **Exposing stack traces to clients** — log internally, return a safe message
- **try/catch around every line** — let errors propagate; catch at boundaries
- **Generic "Something went wrong"** — include enough context for the caller to act
