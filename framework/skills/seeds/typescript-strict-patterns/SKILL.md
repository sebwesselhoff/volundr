---
name: "TypeScript Strict Patterns"
description: "Strict mode, type narrowing, discriminated unions, generics, and avoiding unsafe casts"
domain: "typescript"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "typescript"
  - "types"
  - "generics"
  - "type narrowing"
  - "strict"
  - "union"
  - "interface"
roles:
  - "developer"
  - "reviewer"
---

## Context
Apply when writing TypeScript code in strict mode (`strict: true`). TypeScript's type system catches
entire classes of bugs at compile time; make the most of it.

## Patterns

**Discriminated unions for state machines:**
```typescript
type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User[] }
  | { status: 'error'; message: string };
```

**Narrowing with type guards:**
```typescript
function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
```

**Generics over `any`:**
```typescript
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
```

**`unknown` over `any` for untrusted input** — forces explicit narrowing before use.

**`satisfies` operator** to validate without widening:
```typescript
const config = {
  port: 3000,
  host: 'localhost',
} satisfies Partial<ServerConfig>;
```

**Readonly for data objects:**
```typescript
function processUser(user: Readonly<User>) { ... }
```

## Examples

```typescript
// Type-safe event emitter pattern
type Events = { 'user:created': User; 'card:updated': Card };
class TypedEmitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void) { ... }
  emit<K extends keyof E>(event: K, payload: E[K]) { ... }
}
```

## Anti-Patterns

- **`as any` casts** — almost always avoidable; use `unknown` + narrowing
- **`@ts-ignore`** — find the type error; don't suppress it
- **Overusing `type` for object shapes when `interface` is clearer** — prefer `interface` for public API shapes
- **`!` non-null assertions on values that can genuinely be null** — add a runtime check
- **Ignoring `strict: true`** — turn it on early; retrofitting is painful
