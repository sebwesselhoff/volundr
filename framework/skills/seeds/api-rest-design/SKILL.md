---
name: "REST API Design"
description: "Resource naming, HTTP verbs, status codes, versioning, and error response conventions"
domain: "api"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "api"
  - "rest"
  - "endpoint"
  - "route"
  - "http"
  - "status code"
  - "versioning"
roles:
  - "developer"
  - "architect"
  - "reviewer"
---

## Context
Apply when designing or reviewing HTTP API endpoints. Consistent REST conventions reduce client
integration friction and make APIs self-documenting.

## Patterns

**Resource naming — nouns, plural, kebab-case:**
```
GET    /api/projects          — list
POST   /api/projects          — create
GET    /api/projects/:id      — get one
PATCH  /api/projects/:id      — partial update
DELETE /api/projects/:id      — delete
GET    /api/projects/:id/cards — nested resource list
```

**HTTP status codes:**
- `200 OK` — successful GET, PATCH
- `201 Created` — successful POST (include `Location` header or return created resource)
- `204 No Content` — successful DELETE
- `400 Bad Request` — validation failure (include error detail)
- `401 Unauthorized` — not authenticated
- `403 Forbidden` — authenticated but not allowed
- `404 Not Found` — resource does not exist
- `409 Conflict` — duplicate/constraint violation
- `422 Unprocessable Entity` — business rule violation
- `500 Internal Server Error` — unhandled error

**Consistent error body:**
```json
{ "error": "Card 'CARD-001' not found", "code": "NOT_FOUND" }
```

**Versioning:** prefix with `/api/v2/` only when breaking changes are unavoidable. Prefer
backward-compatible additions.

## Examples

```typescript
// PATCH — partial update, validate before writing
router.patch('/projects/:id', (req, res) => {
  const allowed = ['name', 'status', 'phase'];
  const updates = pick(req.body, allowed);
  if (Object.keys(updates).length === 0) throw new ApiError(400, 'No valid fields to update');
  // ...
});
```

## Anti-Patterns

- **Verbs in URLs** — `/api/createProject` is wrong; use `POST /api/projects`
- **Using GET for mutations** — side effects belong in POST/PATCH/DELETE
- **Returning 200 with `{ success: false }`** — use proper 4xx/5xx codes
- **Deeply nested routes** — more than 2 levels (`/a/:id/b/:id/c`) is a design smell
- **Inconsistent naming** — mixing camelCase and snake_case in the same API
- **No pagination on list endpoints** — always add `?limit=` and `?offset=` or cursor support
