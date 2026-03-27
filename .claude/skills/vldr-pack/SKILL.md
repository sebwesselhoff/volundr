---
name: vldr-pack
description: Pack management for Volundr - install, list, and inspect agent packs (persona seeds, skills, agent types)
user-invocable: true
disable-model-invocation: false
---

# Volundr Pack Manager

Packs are bundles of agent types, persona seeds, and skills grouped by domain (testing, security, frontend, etc.).
Use this skill to list available packs, inspect their contents, and install them for the active project.

## Active Project

!`cat ~/.volundr/projects/registry.json 2>/dev/null | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=r.activeProject;if(p){const proj=r.projects[p];console.log(JSON.stringify({id:p,name:proj.name,path:proj.path}))}else{console.log('NO_ACTIVE_PROJECT')}" 2>/dev/null`

## Framework Path

!`node -e "const path=require('path');const h=process.env.VLDR_HOME||require('os').homedir()+'/.volundr';const fw=path.resolve(__dirname,'../../framework');console.log(JSON.stringify({vldrHome:h,frameworkPath:fw}))" 2>/dev/null || echo '{"vldrHome":"~/.volundr","frameworkPath":"./framework"}'`

## Instructions

1. If active project is `NO_ACTIVE_PROJECT`, say "No active project — start a project first" and stop.

2. Determine the user's intent from their message:
   - **list** — show available packs (default if no argument)
   - **install <pack-name>** — install a pack for the active project
   - **info <pack-name>** — show pack contents without installing
   - **installed** — show which packs are installed for the active project

3. Execute the appropriate section below.

---

### List available packs

Read each pack's manifest from the framework:

```bash
for dir in ./framework/packs/*/; do
  packname=$(basename "$dir")
  if [ -f "$dir/pack.json" ]; then
    echo "--- $packname ---"
    cat "$dir/pack.json"
    echo ""
  fi
done
```

Display as a table:

```
Available packs:

  NAME            VERSION   ALWAYS?  DESCRIPTION
  core            1.0.0     yes      Core agent types — always loaded
  testing         1.0.0     no       Test strategy and execution
  security        1.0.0     no       Security-focused traits
  frontend        1.0.0     no       Frontend and design
  infrastructure  1.0.0     no       Infrastructure and DevOps
  research        1.0.0     no       External API research
  roundtable      2.0.0     no       Blueprint review voices and Chaos Engine
  quality         1.0.0     yes      Quality assurance agents
```

---

### Install a pack

**Step 1:** Read the pack manifest:
```bash
cat ./framework/packs/<PACK_NAME>/pack.json
```

**Step 2:** Discover persona seeds bundled with the pack.
Packs may include persona seeds linked to their agent types.
Check the persona seeds directory for matching personas:
```bash
ls ./framework/personas/seeds/
```

**Step 3:** Install matching persona seeds into the DB for the active project:
For each persona seed whose role matches the pack's `agentTypes`, create the persona if it doesn't exist:
```bash
curl -s http://localhost:3141/api/personas
```
Then for each persona that should be in this pack but isn't in DB yet:
```bash
curl -s -X POST http://localhost:3141/api/personas \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<persona-id>",
    "name": "<name from charter.md>",
    "role": "<role>",
    "expertise": "<expertise string>",
    "style": "<style>",
    "source": "seed"
  }'
```

**Step 4:** Seed skills associated with the pack's agent types.
Check if the relevant skills exist:
```bash
curl -s http://localhost:3141/api/skills | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(s.map(sk=>sk.id).join('\n'))"
```

**Step 5:** Log the installation as an event:
```bash
curl -s -X POST http://localhost:3141/api/projects/<projectId>/events \
  -H "Content-Type: application/json" \
  -d '{"type":"optimization_cycle","detail":"Pack installed: <PACK_NAME> (v<VERSION>)"}'
```

**Step 6:** Report success:
```
Pack '<pack-name>' installed successfully.

  Agent types activated: <list>
  Persona seeds registered: <count>
  Signals registered: <list>

These agent types are now available for spawn decisions.
```

---

### Show pack info (without installing)

Read and display the pack manifest:
```bash
cat ./framework/packs/<PACK_NAME>/pack.json
```

Also show the persona seeds and prompt templates included:
```bash
ls ./framework/packs/<PACK_NAME>/prompts/ 2>/dev/null
ls ./framework/personas/seeds/ 2>/dev/null
```

Display as a structured summary.

---

### Show installed packs

Query which persona seeds are active (proxies for pack installation):
```bash
curl -s "http://localhost:3141/api/personas?status=active"
```

Cross-reference against pack manifests to determine which packs are fully installed.

---

## Pack Signals

Packs declare `signals` — keywords that trigger the pack's agent types during spawn.
When a card's technical notes contain any signal keyword, the matching pack's agents become available.

Example: `testing` pack signals `["test", "coverage", "e2e"]` → when cards mention "e2e tests", the `qa-engineer` and `tester` agents are considered.

---

## Error Handling

- **Pack not found**: List available packs and suggest the closest match.
- **Persona already exists**: Skip with a note (idempotent).
- **Dashboard offline**: Report the error and suggest running `start.bat` / `start.sh`.
