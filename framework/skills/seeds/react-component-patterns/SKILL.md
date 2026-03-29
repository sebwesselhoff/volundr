---
name: "React Component Patterns"
description: "Component composition, hooks, memo/useMemo usage, and avoiding common re-render pitfalls"
domain: "frontend"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "react"
  - "component"
  - "hooks"
  - "useEffect"
  - "useState"
  - "memo"
  - "re-render"
  - "props"
roles:
  - "developer"
  - "designer"
---

## Context
Apply when building React components or reviewing frontend code. Component patterns directly
affect maintainability, performance, and testability.

## Patterns

**Single responsibility** — each component does one thing. Split large components into smaller ones.

**Co-locate state with the component that needs it** — lift state only when siblings need to share it.

**Prefer controlled components** for forms — source of truth in React state, not the DOM.

**`useMemo` / `useCallback` — only when profiling shows benefit:**
```typescript
// Only memoize expensive computations
const sortedItems = useMemo(() => [...items].sort(compareFn), [items]);
```

**Custom hooks to extract logic:**
```typescript
function useSkillMatch(query: string) {
  const [results, setResults] = useState<SkillMatchResult[]>([]);
  useEffect(() => {
    if (!query) return;
    vldr.skills.match({ query }).then(setResults);
  }, [query]);
  return results;
}
```

**Avoid inline object/array literals in JSX props** — they create new references every render:
```tsx
// Bad — new object every render, causes child re-renders
<Card style={{ color: 'red' }} />

// Good
const cardStyle = { color: 'red' } as const;
<Card style={cardStyle} />
```

## Examples

```tsx
// Composition pattern — slot-based layout
function Card({ header, children, footer }: CardProps) {
  return (
    <div className="card">
      <div className="card-header">{header}</div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}
```

## Anti-Patterns

- **`useEffect` for data that can be derived from props/state** — compute inline instead
- **Giant components (>200 lines)** — extract sub-components
- **State for derived values** — if you can compute it from state, don't store it as state
- **`any` props types** — always type component props
- **`key={index}` for dynamic lists** — use stable unique IDs
