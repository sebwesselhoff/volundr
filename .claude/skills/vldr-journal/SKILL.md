---
name: vldr-journal
description: Log a journal entry for the active project. Journal entries capture decisions, insights, blockers, pivots, and milestones for session continuity.
user-invocable: true
disable-model-invocation: false
---

# Volundr Journal

Log a journal entry to the active project via the Dashboard API.

## Usage

The user invokes `/vldr-journal` with either:
- A direct entry: `/vldr-journal "Chose flat hierarchy: only 4 cards"`
- A type + entry: `/vldr-journal decision "Chose flat hierarchy: only 4 cards"`
- No args (show recent): `/vldr-journal`

## Entry Types

| Type | When to log |
|------|-------------|
| `decision` | After making any non-trivial choice |
| `feedback` | When the developer gives input |
| `blocker` | When something blocks progress |
| `insight` | When a pattern or lesson emerges |
| `discussion` | When an important topic is discussed |
| `pivot` | When approach changes significantly |
| `milestone` | At project milestones |

## Execution

### If args provided — log an entry

1. Read the active project from the registry:
```bash
node -e "const f=require('fs'),p=require('path'),h=process.env.VLDR_HOME||(require('os').homedir()+'/.volundr');const r=JSON.parse(f.readFileSync(p.join(h,'projects','registry.json'),'utf8'));console.log(r.activeProject||'')"
```

2. Parse the args: if the first word matches a type (decision/feedback/blocker/insight/discussion/pivot/milestone), use it as `entryType` and the rest as `entry`. Otherwise default to `insight`.

3. POST to the API:
```bash
curl -s -X POST http://localhost:3141/api/journal \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<PROJECT_ID>","entry":"<ENTRY_TEXT>","entryType":"<TYPE>"}'
```

4. Report: `Logged {type}: "{entry}"` with the returned timestamp.

### If no args — show recent entries

```bash
curl -s "http://localhost:3141/api/projects/<PROJECT_ID>/journal?limit=10"
```

Display as a formatted table:
```
Recent journal entries:
  [decision] 2026-03-26 14:30  Chose flat hierarchy: only 4 cards
  [blocker]  2026-03-26 15:10  Drizzle migration failing on nullable JSON
  [insight]  2026-03-26 16:00  Build gate must run AFTER npm install
```
