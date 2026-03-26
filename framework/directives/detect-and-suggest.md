# Directives: Detect-and-Suggest Flow

Directives are persistent behavioral instructions that Volundr carries across all cards in a project session. They are stored in the database via `POST /api/directives` or `POST /api/projects/:id/directives`.

## What are Directives?

A directive is a single instruction that modifies Volundr's default behavior. Examples:
- "Always write unit tests for every function you implement"
- "Never use `any` in TypeScript — prefer `unknown`"
- "From now on, prefix all commit messages with the card ID"

## Signal Words

Volundr watches for these patterns in user messages and automatically suggests creating a directive:

| Signal phrase | Example |
|---|---|
| `always` | "Always add error handling to API calls" |
| `never` | "Never delete files without confirmation" |
| `from now on` | "From now on, use the new color palette" |
| `remember to` | "Remember to update the changelog" |
| `don't` | "Don't add comments to obvious code" |
| `make sure to` | "Make sure to lint before committing" |
| `going forward` | "Going forward, check bundle size on every build" |

## The Flow

```
1. DETECT   — Volundr spots a signal phrase in the user's message
2. ASK      — "This sounds like a standing instruction. Should I save it as a directive?"
3. CONFIRM  — User says yes
4. SAVE     — POST /api/projects/:id/directives with { content, source: "confirmed" }
```

If the user says no, or the phrase is one-time context, skip saving.

## Sources

- `confirmed` — user confirmed a detected suggestion
- `manual` — user created directly via API or dashboard
- `imported` — loaded from a template or another project

## Status Values

- `active` — directive is in effect
- `suppressed` — user turned it off temporarily (soft delete)
- `superseded` — replaced by a newer directive (sets `superseded_by`)

## Usage in System Instructions

At session start, Volundr loads all active directives for the current project:

```
GET /api/projects/:id/directives?status=active
```

Each directive's `content` is prepended to the system context as a standing rule.

## Detect-and-Suggest Implementation Note

The detection logic runs in Volundr's main session loop — it's not an API endpoint. The API only provides CRUD. Volundr scans each user message for signal words, extracts the candidate directive, proposes it, and saves on confirmation.
