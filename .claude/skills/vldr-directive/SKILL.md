---
name: vldr-directive
description: Manage Volundr governance directives - list, add, suppress, or supersede active directives for a project
user-invocable: true
disable-model-invocation: false
---

# Volundr Directive Manager

Governance directives are standing rules that apply to all agent work in a project (or globally).
Use this skill to list, add, suppress, or supersede directives.

## Active Project

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=r.activeProject;if(p){console.log(p)}else{console.log('NO_ACTIVE_PROJECT')}" 2>/dev/null`

## Instructions

1. If the output above is `NO_ACTIVE_PROJECT`, say "No active project — start a project first" and stop.

2. Determine the user's intent from their message:
   - **list** — show current active directives
   - **add** — create a new directive
   - **suppress** — soft-delete a directive (set status = suppressed)
   - **supersede** — mark an old directive as replaced by a new one

3. Execute the appropriate action below.

---

### List directives

```bash
curl -s "http://localhost:3141/api/projects/{projectId}/directives?status=active"
```

Display as a numbered table:

```
Active directives for project <name>:

  #<id>  [<source>]  pri=<priority>  <content>
  ...
  (none)
```

Sources: `confirmed` = approved by user, `manual` = added via CLI, `imported` = from lessons/patterns.

---

### Add directive

Before creating, **check for duplicates**:
1. Fetch active directives: `GET /api/projects/{id}/directives?status=active`
2. Scan content for semantic overlap (same rule rephrased). If a near-duplicate exists, show it and ask the user to confirm before creating.

To create:
```bash
curl -s -X POST http://localhost:3141/api/projects/{projectId}/directives \
  -H "Content-Type: application/json" \
  -d '{"content": "<DIRECTIVE_TEXT>", "source": "manual", "priority": 0}'
```

Report the created directive ID and content.

---

### Suppress directive

Soft-deletes the directive (status becomes `suppressed`). Reversible by setting status back to `active`.

```bash
curl -s -X DELETE http://localhost:3141/api/directives/{id}
```

Confirm with the user before suppressing. Show the directive content first.

---

### Supersede directive

Replaces an old directive with a new one. The old directive is linked to the new via `supersededBy`.

Steps:
1. Create the new directive (POST as above).
2. Link the old directive to the new one:
   ```bash
   curl -s -X PATCH http://localhost:3141/api/directives/{oldId} \
     -H "Content-Type: application/json" \
     -d '{"status": "superseded", "supersededBy": <newId>}'
   ```

Report both old and new directive IDs.

---

## Deduplication Rules

When adding a directive, consider it a duplicate if an existing active directive:
- Says the same thing in different words, OR
- Covers a strict subset of the new rule (new rule is broader), OR
- Directly contradicts the new rule (warn the user instead of silently creating)

When a near-duplicate is found, output:
```
Near-duplicate detected:
  Existing #<id>: "<existing content>"
  New:            "<new content>"

Proceed anyway? (yes/no)
```

Only create if the user confirms or if there is no overlap.

---

## Quick Reference

| Operation | Endpoint |
|---|---|
| List project + global | GET /api/projects/{id}/directives |
| List global only | GET /api/directives |
| Create project | POST /api/projects/{id}/directives |
| Create global | POST /api/directives |
| Update / supersede | PATCH /api/directives/{id} |
| Suppress | DELETE /api/directives/{id} |
| Hard delete | DELETE /api/directives/{id}?hard=true |
