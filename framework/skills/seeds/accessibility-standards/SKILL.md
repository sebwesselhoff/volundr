---
name: "Accessibility Standards"
description: "WCAG 2.1, semantic HTML, ARIA roles, keyboard navigation, and screen reader patterns"
domain: "frontend"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "accessibility"
  - "a11y"
  - "aria"
  - "wcag"
  - "screen reader"
  - "keyboard navigation"
  - "semantic html"
roles:
  - "developer"
  - "designer"
  - "reviewer"
---

## Context
Apply when building UI components, reviewing frontend code, or auditing pages. Accessibility is a
legal requirement in many jurisdictions and directly improves usability for all users.

## Patterns

**Semantic HTML first** — use the right element before reaching for ARIA:
- `<button>` for interactive controls, not `<div onClick>`
- `<nav>`, `<main>`, `<header>`, `<footer>` for landmarks
- `<h1>`–`<h6>` in logical order (don't skip levels)
- `<label>` associated with every form input

**ARIA — only when semantic HTML is insufficient:**
```html
<!-- Good: ARIA supplements the native role -->
<button aria-expanded={isOpen} aria-controls="menu-list">Menu</button>

<!-- Bad: reinventing a button with ARIA -->
<div role="button" tabIndex={0} onClick={handleClick}>Click</div>
```

**Keyboard navigation — everything reachable by Tab, actions by Enter/Space:**
- Custom dropdowns: arrow keys navigate options, Escape closes
- Modals: trap focus inside when open; restore focus on close

**Color contrast** — minimum 4.5:1 for normal text, 3:1 for large text (WCAG AA).

**Images — always provide text alternatives:**
```html
<img src="chart.png" alt="Bar chart showing card completion rate by week" />
<!-- Decorative images -->
<img src="divider.svg" alt="" role="presentation" />
```

**Focus visible** — never `outline: none` without a custom focus style.

## Examples

```tsx
// Accessible modal
function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const headingId = useId();
  return isOpen ? (
    <div role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  ) : null;
}
```

## Anti-Patterns

- **`onClick` on non-interactive elements** — use `<button>` or `<a>`
- **Missing `alt` text on images** — even decorative images need `alt=""`
- **`display: none` for content that should be announced** — use `aria-hidden` judiciously
- **Form inputs without labels** — placeholder is not a label
- **Tab order breaks visual flow** — `tabIndex > 0` disrupts natural order; avoid
