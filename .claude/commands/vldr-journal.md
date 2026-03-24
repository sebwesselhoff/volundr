Log a journal entry for the active project. Journal entries capture decisions, insights, blockers, and pivots - cognitive context that helps future sessions understand what happened and why.

## Usage

`/vldr-journal <type> <entry>`

Types: `decision`, `insight`, `blocker`, `pivot`, `feedback`, `milestone`, `discussion`

## Instructions

1. Determine the active project from `~/.volundr/projects/registry.json`
2. If no argument provided, show recent journal entries:
   `curl -s http://localhost:3141/api/projects/{id}/journal?limit=10`
   Format as a readable list with timestamps and types.
3. If arguments provided, parse the type and entry text, then POST:
   ```
   curl -s -X POST http://localhost:3141/api/journal \
     -H "Content-Type: application/json" \
     -d '{"projectId":"{id}","entry":"{text}","entryType":"{type}"}'
   ```
4. Confirm: "Logged {type}: {entry}"

## Examples

- `/vldr-journal decision Chose flat hierarchy - only 4 cards, no cross-domain deps`
- `/vldr-journal blocker Drizzle migration failing on nullable JSON columns`
- `/vldr-journal insight Build gate must run AFTER npm install, not before`
- `/vldr-journal` (no args - shows recent entries)
