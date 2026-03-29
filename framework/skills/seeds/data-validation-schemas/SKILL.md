---
name: "Data Validation & Schemas"
description: "Zod, runtime validation, input sanitization, and schema-first API design"
domain: "engineering"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "validation"
  - "schema"
  - "zod"
  - "input validation"
  - "sanitize"
  - "parse"
  - "dto"
roles:
  - "developer"
  - "reviewer"
---

## Context
Apply when accepting external input (HTTP requests, file uploads, user forms, environment
variables). Validation at system boundaries prevents entire classes of bugs and security issues.

## Patterns

**Validate at the entry point, trust internally:**
- Validate HTTP request body/params/query before any business logic
- Once data passes validation, pass the typed result through — don't re-validate

**Zod for runtime validation with TypeScript types:**
```typescript
const CreateSkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  domain: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  triggers: z.array(z.string()).default([]),
});

type CreateSkillInput = z.infer<typeof CreateSkillSchema>;
```

**Parse, don't validate:**
```typescript
// parse() throws on failure with detailed error message
const data = CreateSkillSchema.parse(req.body);
// safeParse() returns { success, data, error } — use when you handle the error yourself
const result = CreateSkillSchema.safeParse(req.body);
```

**Environment variable validation on startup:**
```typescript
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
});
const env = EnvSchema.parse(process.env);
```

**Sanitize user-provided strings** — strip HTML/SQL-special characters before displaying or storing.

## Examples

```typescript
// Express route with Zod validation
router.post('/skills', (req, res) => {
  const data = CreateSkillSchema.parse(req.body);  // throws ApiError if invalid
  const skill = db.createSkill(data);
  res.status(201).json(skill);
});

// Global Zod error handler
app.use((err: unknown, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.errors[0].message });
  }
  next(err);
});
```

## Anti-Patterns

- **Validating only in the client** — always validate server-side; client validation is UX only
- **Manual `if (!body.field)` chains** — use a schema library for consistency and error messages
- **Trusting `typeof` for complex shapes** — `typeof x === 'object'` does not validate nested structure
- **Parsing the same data multiple times** — parse once, pass the typed result through
- **Silently coercing invalid data** — fail loudly at the boundary; don't guess intent
