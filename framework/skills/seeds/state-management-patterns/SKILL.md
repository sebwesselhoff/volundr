---
name: "State Management Patterns"
description: "Local vs global state, Zustand/Redux patterns, server state caching, and avoiding over-engineering"
domain: "frontend"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "state management"
  - "zustand"
  - "redux"
  - "global state"
  - "context"
  - "server state"
  - "react query"
roles:
  - "developer"
  - "architect"
---

## Context
Apply when deciding how to manage application state across components. Over-engineering state
management is common; most apps need less global state than developers think.

## Patterns

**State hierarchy — use the simplest layer that works:**
1. Local `useState` — single component
2. Lifted state — shared between siblings via parent
3. Context — shared across a subtree without prop drilling
4. Global store (Zustand/Redux) — truly application-wide state
5. Server state cache (React Query/SWR) — data from an API

**Server state is different from UI state:**
- Server data: loading/error/stale states, refetch, caching
- UI state: modal open, selected tab, form values
- Use React Query / SWR for server data; keep global stores for UI-only state

**Zustand minimal store:**
```typescript
const useProjectStore = create<ProjectState>((set) => ({
  activeProjectId: null,
  setActiveProject: (id) => set({ activeProjectId: id }),
}));
```

**Avoid putting derived state in the store** — compute from existing state in selectors.

## Examples

```typescript
// React Query for server data
const { data: skills, isLoading } = useQuery({
  queryKey: ['skills', domain],
  queryFn: () => vldr.skills.list({ domain }),
  staleTime: 30_000,
});
```

## Anti-Patterns

- **Global store for component-local state** — a modal's open state does not belong in Redux
- **Fetching API data directly in `useEffect` without caching** — use React Query/SWR
- **Over-normalized Redux state** — don't replicate a database in your store
- **Context for high-frequency updates** — React Context re-renders all consumers; use Zustand instead
- **Storing server data in local state** — skip the middleman, use a server state library
