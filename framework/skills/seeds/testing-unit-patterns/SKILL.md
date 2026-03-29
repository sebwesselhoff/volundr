---
name: "Unit Testing Patterns"
description: "Arrange-Act-Assert, test isolation, mocking, and coverage strategies for unit tests"
domain: "testing"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "test"
  - "unit test"
  - "jest"
  - "vitest"
  - "mock"
  - "coverage"
  - "assert"
roles:
  - "developer"
  - "qa-engineer"
---

## Context
Apply when writing or reviewing unit tests for functions, classes, or modules. Unit tests verify a
single unit of behavior in isolation from external dependencies (DB, network, filesystem).

## Patterns

**Arrange-Act-Assert (AAA) structure:**
```typescript
it('returns discounted price when user is premium', () => {
  // Arrange
  const user = { tier: 'premium' };
  const price = 100;
  // Act
  const result = applyDiscount(price, user);
  // Assert
  expect(result).toBe(80);
});
```

**Mock external dependencies, never internals:**
- Mock at the boundary: HTTP clients, DB drivers, filesystem
- Do not mock the unit under test or its pure helpers
- Use `vi.fn()` (Vitest) or `jest.fn()` for function mocks

**One assertion concept per test** — multiple `expect` calls for one idea is fine; multiple
unrelated concepts is not.

**Test file co-location:** `src/utils/price.ts` → `src/utils/price.test.ts`

**Coverage targets:** aim for 80%+ line coverage on business logic; 100% on critical paths
(auth, payment, data integrity).

## Examples

```typescript
// Good — isolated, clear intent
vi.mock('../db', () => ({ getUser: vi.fn() }));

it('throws if user not found', async () => {
  vi.mocked(getUser).mockResolvedValue(null);
  await expect(getUserProfile('u-404')).rejects.toThrow('User not found');
});
```

```typescript
// Parameterized tests for edge cases
it.each([
  [0, 'zero'],
  [-1, 'negative'],
  [NaN, 'NaN'],
])('rejects invalid quantity %s (%s)', (qty) => {
  expect(() => validateQty(qty)).toThrow();
});
```

## Anti-Patterns

- **Testing implementation details** — tests should break when behavior changes, not when you rename a private variable
- **Shared mutable state between tests** — always reset mocks in `beforeEach` or `afterEach`
- **Testing the framework** — do not assert that `express` routes correctly; test your handler logic
- **Giant test files** — split by feature, not by file-under-test
- **Snapshot tests for logic** — use snapshots for UI components only, not for computed values
