---
name: "Database Query Patterns"
description: "Efficient querying, indexing, N+1 avoidance, transactions, and ORM best practices"
domain: "database"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "database"
  - "query"
  - "sql"
  - "index"
  - "transaction"
  - "orm"
  - "drizzle"
  - "prisma"
  - "n+1"
roles:
  - "developer"
  - "architect"
---

## Context
Apply when writing database queries, designing schemas, or reviewing data access code. Poor query
patterns are a common source of performance problems and data integrity bugs.

## Patterns

**Avoid N+1 queries — eager-load relationships:**
```typescript
// Bad: one query per card
const cards = db.select().from(cards).all();
for (const card of cards) {
  card.epic = db.select().from(epics).where(eq(epics.id, card.epicId)).get();
}

// Good: join in one query
const result = db.select().from(cards)
  .leftJoin(epics, eq(cards.epicId, epics.id))
  .all();
```

**Transactions for multi-step writes:**
```typescript
db.transaction((tx) => {
  tx.insert(cards).values(card).run();
  tx.insert(events).values({ type: 'card.created', ... }).run();
});
```

**Index columns you filter or sort by:**
- Foreign keys (always)
- `status`, `created_at` (common filter/sort targets)
- Unique constraints enforce data integrity

**Parameterized queries always** — never string-concatenate user input into SQL.

**SELECT only needed columns** — avoid `SELECT *` in hot paths.

## Examples

```typescript
// Drizzle: selective columns + where clause
const activeCards = db.select({
  id: cards.id,
  title: cards.title,
  status: cards.status,
}).from(cards)
  .where(and(eq(cards.projectId, projectId), eq(cards.status, 'in-progress')))
  .all();
```

## Anti-Patterns

- **Raw string queries with user input** — SQL injection vulnerability
- **SELECT * in production queries** — transfers unnecessary data, breaks when schema changes
- **Long transactions** — hold locks for the minimum time; don't do HTTP calls inside a transaction
- **Missing foreign key constraints** — orphaned rows cause hard-to-debug bugs
- **Soft deletes without indexes on the deleted flag** — full table scans on every query
