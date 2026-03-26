---
name: vldr-doctor
description: Validate Volundr setup - checks Docker, dashboard, VLDR_HOME, registry, DB, git, node, hooks
user-invocable: true
disable-model-invocation: false
---

# Volundr Setup Doctor

Run the following checks in order using Bash tool calls and report results with pass/fail/warning indicators.

Use `✓` for pass, `✗` for fail, `⚠` for warning (non-fatal). Collect all results, then print the summary block at the end.

## Checks to Run

**1. VLDR_HOME exists**
```bash
VLDR_HOME="${VLDR_HOME:-$HOME/.volundr}"
if [ -d "$VLDR_HOME" ]; then echo "PASS: $VLDR_HOME"; else echo "FAIL: $VLDR_HOME not found"; fi
```

**2. Dashboard healthy**
```bash
result=$(curl -s --max-time 5 http://localhost:3141/api/health 2>/dev/null)
if echo "$result" | grep -q '"status":"ok"'; then
  uptime=$(echo "$result" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.uptime||'')" 2>/dev/null)
  echo "PASS: healthy uptime=$uptime"
else
  echo "FAIL: dashboard not responding or unhealthy"
fi
```

**3. Project registry valid**
```bash
node -e "const p=require('path'),f=require('fs');const h=process.env.VLDR_HOME||(require('os').homedir()+'/.volundr');const reg=p.join(h,'projects','registry.json');if(!f.existsSync(reg)){console.log('FAIL: registry.json not found at '+reg);process.exit(0);}try{const r=JSON.parse(f.readFileSync(reg,'utf8'));const count=Object.keys(r.projects||{}).length;console.log('PASS: '+count+' projects, active='+(r.activeProject||'none'))}catch(e){console.log('FAIL: could not parse registry.json')}"
```

**4. DB status**
```bash
result=$(curl -s --max-time 5 http://localhost:3141/api/db/status 2>/dev/null)
if [ -n "$result" ]; then
  echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log('PASS: schema v'+j.schemaVersion+', size='+(j.dbSize/1024).toFixed(0)+'KB')}catch{console.log('SKIP: could not parse db/status')}})" 2>/dev/null || echo "SKIP: /api/db/status not available"
else
  echo "SKIP: /api/db/status endpoint not available"
fi
```

**5. Git version**
```bash
ver=$(git --version 2>/dev/null | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
if [ -n "$ver" ]; then
  major=$(echo $ver | cut -d. -f1)
  minor=$(echo $ver | cut -d. -f2)
  if [ "$major" -gt 2 ] || ([ "$major" -eq 2 ] && [ "$minor" -ge 30 ]); then
    echo "PASS: $ver (worktree support ok)"
  else
    echo "FAIL: $ver is too old (need >= 2.30 for worktree support)"
  fi
else
  echo "FAIL: git not found"
fi
```

**6. Node.js version**
```bash
ver=$(node --version 2>/dev/null)
if [ -n "$ver" ]; then echo "PASS: $ver"; else echo "FAIL: node not found"; fi
```

**7. Docker Desktop**
```bash
if docker info >/dev/null 2>&1; then
  echo "PASS: Docker running"
else
  echo "WARN: Docker not running (optional - needed for dashboard)"
fi
```

**8. Hooks installed**
```bash
count=$(ls "$CLAUDE_PROJECT_DIR/.claude/hooks/"*.js 2>/dev/null | wc -l)
echo "PASS: $count hook files installed"
```

**9. Enforcement hooks present**
```bash
hdir="$CLAUDE_PROJECT_DIR/.claude/hooks"
missing=0
for f in enforce-bash-rules.js enforce-card-deps.js enforce-worktree-isolation.js post-bash-git.js; do
  if [ ! -f "$hdir/$f" ]; then missing=$((missing+1)); fi
done
present=$((4-missing))
if [ $missing -eq 0 ]; then
  echo "PASS: 4/4 enforcement hooks active"
else
  echo "WARN: $present/4 enforcement hooks present ($missing missing)"
fi
```

**10. Settings valid**
```bash
settings="$CLAUDE_PROJECT_DIR/.claude/settings.json"
if [ -f "$settings" ]; then
  val=$(node -e "const s=JSON.parse(require('fs').readFileSync('$settings','utf8'));console.log(s.env&&s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)" 2>/dev/null)
  if [ "$val" = "1" ]; then
    echo "PASS: Agent Teams enabled"
  else
    echo "FAIL: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS not set to '1'"
  fi
else
  echo "FAIL: .claude/settings.json not found"
fi
```

**11. Active project**
```bash
node -e "const p=require('path'),f=require('fs');const h=process.env.VLDR_HOME||(require('os').homedir()+'/.volundr');const reg=p.join(h,'projects','registry.json');if(!f.existsSync(reg)){console.log('No registry');process.exit(0);}const r=JSON.parse(f.readFileSync(reg,'utf8'));const id=r.activeProject;if(id){const proj=r.projects&&r.projects[id];console.log('Active: '+id+(proj?' ('+proj.name+')':''))}else{console.log('No active project')}"
```

## Output Format

After running all checks, print the full summary block:

```
Checking Volundr setup...
  ✓ VLDR_HOME: ~/.volundr (exists)
  ✓ Dashboard: healthy (uptime: Xh)
  ✓ Registry: N projects
  ✓ DB: schema vN, size NKB
  ✓ Git: 2.50.0 (worktree support ✓)
  ✓ Node.js: v24.4.1
  ⚠ Docker: not running (optional)
  ✓ Hooks: 14 installed
  ✓ Enforcement: 4/4 active
  ✓ Settings: Agent Teams enabled
  ✓ Active project: vldr-v5 (Volundr v5)

All checks passed.  (or: N check(s) failed — see ✗ items above)
```

Replace placeholder values with actual results from the Bash checks above. Use `✓` for PASS, `✗` for FAIL, `⚠` for WARN/SKIP.
