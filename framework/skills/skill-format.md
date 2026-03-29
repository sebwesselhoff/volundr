# SKILL.md Format

Skills are stored as directories with a SKILL.md file inside:
`VLDR_HOME/skills/{skill-id}/SKILL.md`

Framework seed skills live at:
`framework/skills/seeds/{skill-id}/SKILL.md`

## Format

YAML frontmatter (between `---` markers) + markdown body:

```yaml
---
name: "Authentication Patterns"
description: "JWT, OAuth2, session management, refresh tokens"
domain: "security"
confidence: "high"          # low | medium | high
source: "seed"              # seed | earned | extracted | imported
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"  # 6 months after validation
triggers:                   # keywords that trigger this skill during matching
  - "authentication"
  - "jwt"
  - "oauth"
roles:                      # which persona roles can use this skill
  - "developer"
  - "security-reviewer"
---

## Context
{When and why this skill applies — situational triggers and preconditions}

## Patterns
{Key patterns and best practices, listed concisely}

## Examples
{Concrete code examples or command sequences}

## Anti-Patterns
{What NOT to do — common mistakes to avoid}
```

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Human-readable display name |
| `description` | string | One-line summary for skill matching |
| `domain` | string | Skill category (security, git, testing, infra, ...) |

## Optional Fields with Defaults

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `confidence` | enum | `"medium"` | `low \| medium \| high` |
| `source` | string | `"seed"` | `seed \| earned \| extracted \| imported` |
| `version` | number | `1` | Incremented on significant content updates |
| `validatedAt` | string | today | ISO date of last validation |
| `reviewByDate` | string | +6 months | ISO date when skill should be reviewed |
| `triggers` | string[] | `[]` | Keywords for automatic skill matching |
| `roles` | string[] | `[]` | Empty = available to all roles |

## Body Sections

Sections are parsed by heading name (H2 level). Recognized sections:
- `## Context` — when this skill applies
- `## Patterns` — best practices
- `## Examples` — code/command examples
- `## Anti-Patterns` — what to avoid

Additional sections are preserved in the body but not extracted as named sections.

## Validation Rules

1. Frontmatter must be enclosed in `---` markers at the top of the file
2. `name`, `description`, and `domain` are required — parser throws if missing
3. Arrays are expressed as YAML block sequences (`  - item`)
4. String values may be quoted or unquoted (no multi-line strings)
5. Numbers must not be quoted (`version: 1` not `version: "1"`)
