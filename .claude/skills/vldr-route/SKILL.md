---
name: vldr-route
description: Test Volundr routing rules - match a work description against active routing rules and show tier selection
user-invocable: true
disable-model-invocation: false
---

# Volundr Route Tester

Test how Volundr would route a card description against the active routing rules and which response tier would be selected.

## Active Project

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=r.activeProject;if(p){console.log(p)}else{console.log('NO_ACTIVE_PROJECT')}" 2>/dev/null`

## Instructions

1. If the output above is `NO_ACTIVE_PROJECT`, say "No active project — start a project first" and stop.

2. Ask the user for the card description to test if they did not already provide one.
   Also ask (or infer from context) the card size (XS|S|M|L|XL), and optionally a module path.

3. POST to the routing test endpoint:
   ```bash
   curl -s -X POST http://localhost:3141/api/routing-rules/test \
     -H "Content-Type: application/json" \
     -d '{"description": "<DESCRIPTION>", "modulePath": "<MODULE_PATH_OR_OMIT>", "conjunctive": false}'
   ```

4. Also determine the response tier by inferring:
   - Card size provided by user (default S if not given)
   - Count of matched rules to estimate domain count
   - Whether any ceremony signals appear in the description

5. Format the output as:

```
Route test: "<description>"

Matched rules (scored):
  #1  <personaId>  score=<N>  matched=<what matched>
  #2  ...
  (none — no rules matched)

Best match: <personaId> (or: no match)

Tier selection:
  Card size:   <size>
  Domain count: <N>
  Base tier:   <tier>
  Load level:  normal
  Effective:   <tier>
```

6. If the dashboard is offline, report that and suggest starting it with `start.bat` or `start.sh`.

## Tier Selection Reference

| Condition | Tier |
|---|---|
| isCeremonyEvent or isAuditOrRetro | ceremony |
| XS + 1 domain + <=1 file | minimal |
| domainCount > 1 OR files > 5 OR L/XL | detailed |
| everything else | standard |

Load downgrade (if load level is provided):
- high: tier drops 1 step (ceremony immune)
- critical: tier drops 2 steps (ceremony immune)
