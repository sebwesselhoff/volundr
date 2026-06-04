# Spike — Expose the Volundr dashboard as an MCP server (FRW-BL-040)

**Status:** SPIKE / PoC. **No production migration in this card.** Nothing here is
wired into `.claude/settings.json`, no `package.json` is touched, no npm dependency
is added. Deliverable = cost/benefit, a runnable PoC, and a go/no-go.

CC version floors (framework/cc-version-baseline.md): mcp_tool hooks — 2.1.118 ;
alwaysLoad MCP — 2.1.121 ; --strict-mcp-config for subagents — 2.1.150. This machine
runs 2.1.161, so all are available.

---

## 1. The question

Today the dashboard is reached three ways:

1. Hooks -> .claude/hooks/vldr-api.js (fetch-based apiGet/apiPost/apiPatch).
2. The model / SDK consumers -> @vldr/sdk VolundrClient (typed http.patch(...) etc.).
3. Skills and slash-commands -> raw curl against http://localhost:3141/api/...

Should we add a fourth path: a thin stdio MCP server that exposes dashboard
operations as typed MCP tools the model (and mcp_tool hooks) can call directly?

---

## 2. Inventory — what a wrapper would replace (cited counts)

Counted from this worktree (.claude/hooks/*.js excluding *.test.js, plus
.claude/skills / .claude/commands):

### 2a. Hook calls — already go through vldr-api.js, NOT raw curl

vldr-api.js is the shared helper; every hook imports it. Call-sites across 19
non-test hooks:

| Verb | Helper | Call-sites |
|------|--------|-----------:|
| Reads | apiGet(...) | 34 |
| Writes | apiPost(...) | 36 |
| Writes | apiPatch(...) | 10 |
| Total | | 80 |

Distinct endpoints hit by hooks (top entries):

- Writes: POST /api/events (28x — by far the dominant call), POST /api/agents (5),
  PATCH /api/agents/:id (8 across variable names), POST /api/cards/:id/checkout (1),
  PATCH /api/cards/:id (1 — in task-completed.js), POST /api/session-summaries (1).
- Reads: GET /api/projects/:id/agents (8), GET /api/projects/:id/cards (6),
  GET /api/cards/:id (4), GET /api/projects/:id (3), plus single reads of
  session-summaries / quality / lessons / journal / events.

Key finding: hooks do NOT curl. They already share one typed-ish helper with
timeouts and swallowed errors. So the often-cited "no curl escaping" win does NOT
apply to the hook surface — that surface is already clean. The PATCH-body mapping a
wrapper would own is already centralized in vldr-api.js + @vldr/sdk.

### 2b. Skill / command calls — these ARE raw curl

.claude/skills/* and .claude/commands/* use raw curl (shell-quoted JSON bodies):

- ~30 curl call-sites to localhost:3141/api/...
- Verb mix: 11 POST, 3 PATCH, 1 DELETE, remainder GET.
- Endpoints: economy toggle (3), personas (3), directives (CRUD), journal, events,
  routing-rules/test, health, db/status, metrics, cards, agents.

This is where curl-escaping pain actually lives — e.g. vldr-economy and
vldr-directive hand-build -d JSON bodies in shell. These are the realistic
beneficiaries of typed MCP tools (and the most exposed to quoting bugs across
PowerShell vs bash).

### 2c. SDK

@vldr/sdk already gives fully-typed resources (client.cards.update(id, {status})
-> PATCH /api/cards/:id). Any MCP server we build is best implemented AS an SDK
consumer, not as a re-implementation of the HTTP calls — the wrapper would be a thin
tools layer over VolundrClient.

---

## 3. Cost / benefit

### What gets SIMPLER (benefits)

- Typed, discoverable tools for the model. tools/list advertises name + JSON-Schema
  inputSchema; the model self-discovers update_card_status(cardId, status) with
  status constrained to an enum. No prose "here's the curl to run."
- No shell quoting for the model/skills. Tool args are structured JSON; the MCP
  runtime owns framing. This directly retires the curl-escaping risk in 2b.
- Input validation at the boundary. The PoC rejects unknown statuses and
  path-injection card ids BEFORE any HTTP call (see poc/map.js). A raw curl silently
  sends a no-op PATCH on a typo'd status.
- Per-server cost attribution in /usage (see section 4).
- mcp_tool hooks (CC >= 2.1.118) — a hook can invoke a tool by name instead of
  shelling helper logic. Cleaner than embedding fetch logic.
- One audited write surface. Centralizing dashboard writes behind a small, vetted
  tool list pairs well with the existing pack MCP-governance allow/deny model
  (framework/packs/MCP-GOVERNANCE.md).

### What gets HARDER / RISKIER (costs)

- Extra process + stdio lifecycle. Each Claude session spawns/owns the stdio server;
  we inherit its start/stop, crash-restart, and zombie-process concerns. Today a hook
  is a short-lived node invocation that exits — no long-lived child.
- Headless / cron availability caveat (the big one). Interactively-authenticated or
  interactively-configured MCP servers MAY be absent in headless / non-interactive
  runs. Volundr's whole value prop is unattended operation
  (--dangerously-skip-permissions, cron-style relaunches via start.bat/start.sh). If
  dashboard writes migrated to an MCP tool and that server is not present headless,
  telemetry/state writes would silently vanish — strictly worse than the current
  always-available fetch path. A stdio (not remote-auth) server config is the safer
  shape, but this must be live-verified headless before any migration.
- Auth / multi-project. vldr-api.js resolves PROJECT_ID per-invocation from env or
  registry.json. A long-lived MCP server caches one project context at startup;
  Volundr switches active project. The server would need per-call projectId args or
  hot re-read of the registry — added complexity the fetch path gets for free.
- Redundant with the SDK. The typed-call benefit for code already exists via
  @vldr/sdk. MCP's incremental value is for the model, not for hooks (which are code
  and already clean).
- New dependency. A production server should use @modelcontextprotocol/sdk (the PoC
  hand-rolls JSON-RPC to avoid the dep for the spike). That is a new supply-chain +
  maintenance surface in the launcher.
- Two sources of truth risk. If some writes go via MCP and others via fetch/curl,
  reviewers must reason about both paths. Partial migration is the worst outcome.

### Migration surface (how many call-sites change)

- Hooks: 80 call-sites — but they already share vldr-api.js. Migrating them to MCP
  buys little (they're code, not model-facing) and risks the headless caveat on the
  highest-volume write (POST /api/events, 28x). Recommend: leave hooks on fetch.
- Skills/commands: ~30 curl call-sites — the real candidates. Even here, only the
  model-facing mutations (economy toggle, directive CRUD, journal/events POST)
  meaningfully benefit.
- SDK: unchanged; the wrapper consumes it.

So a sensible migration touches ~14 skill/command WRITE curls, not the 80 hooks.

---

## 4. Per-server cost visibility in /usage

Claude Code's /usage attributes token cost per MCP server: each connected server's
tool definitions occupy system-prompt context (their name + description +
inputSchema are injected when loaded), and /usage surfaces that per-server footprint
so you can see which servers are expensive to keep loaded. This is exactly why
framework/packs/MCP-GOVERNANCE.md keeps alwaysLoad to one server per pack and defers
the rest behind tool-search.

What we'd gain: a vldr-dashboard server would show up as its own line in /usage,
making the dashboard-tools' context cost explicit and tunable (e.g. keep the server
deferred / not alwaysLoad so it costs nothing until a tool is searched). That
visibility is better than the status quo, where hook fetch calls have no per-surface
cost line at all (they cost zero context, but also can't be budgeted/seen as a unit).

Out of spike scope (stated explicitly): capturing a LIVE /usage reading for this
server is out of scope — it requires registering the server in a real session and
running /usage, which is production wiring this card forbids. We document the
EXPECTATION (per-server attribution) rather than a measured number.

---

## 5. PoC

Location: framework/research/mcp-dashboard-spike/poc/

| File | What it is |
|------|-----------|
| map.js | Pure-node request mapping: update_card_status(cardId, status) -> { method:'PATCH', url:'/api/cards/:id', body:{status} }. Validates status enum + card-id charset. Zero deps, zero network. |
| map.test.js | Pure-node unit test of the mapping (7 assertions). |
| server.js | Minimal stdio MCP server (hand-rolled JSON-RPC 2.0 over newline-delimited stdin/stdout) exposing update_card_status. Issues a real PATCH via global fetch. Documents the @modelcontextprotocol/sdk dep a production version WOULD use instead. |
| harness.test.js | End-to-end: spawns server.js, pipes initialize/tools/list/tools/call frames, points it at a throwaway local HTTP stub, asserts the stub received exactly PATCH /api/cards/FRW-BL-040 with body {status:'done'}, and that a bad status returns isError:true. Zero deps, zero live dashboard. |

### Why hand-rolled JSON-RPC instead of the MCP SDK?

This is a PoC and the card forbids adding deps. A production server should depend on
@modelcontextprotocol/sdk (Server + StdioServerTransport) for spec-complete framing,
capability negotiation, notifications, and forward-compat. The hand-rolled version
implements just enough of the protocol (initialize, tools/list, tools/call) to run
end-to-end TODAY and prove the request-mapping is correct — which is the load-bearing
claim. The SDK swap is mechanical: the same map.js + callUpdateCardStatus logic
registers as a tool handler; only the transport changes.

### Run it

    # Pure-node mapping unit test (no deps, no network)
    node framework/research/mcp-dashboard-spike/poc/map.test.js

    # End-to-end stdio framing + real PATCH against a local stub (no deps, no dashboard)
    node framework/research/mcp-dashboard-spike/poc/harness.test.js

    # Manual smoke against a LIVE dashboard (optional): paste JSON-RPC on stdin
    VLDR_API_URL=http://localhost:3141 node framework/research/mcp-dashboard-spike/poc/server.js
    # then send these frames:
    # {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
    # {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
    # {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"update_card_status","arguments":{"cardId":"FRW-BL-040","status":"done"}}}

### Captured output (this machine, Node v24.4.1)

    === map.test.js ===
    ok   - maps a valid call to PATCH /api/cards/:id with { status } body
    ok   - normalises a trailing slash on apiUrl
    ok   - defaults apiUrl to http://localhost:3141 when omitted
    ok   - accepts every valid status
    ok   - rejects an unknown status
    ok   - rejects a missing cardId
    ok   - rejects a cardId with injection characters
    7 passed, 0 failed

    === harness.test.js ===
    ok   - initialize returns serverInfo + protocolVersion
    ok   - tools/list advertises update_card_status
    ok   - tools/call (valid) returns isError:false
    ok   - stub received exactly one PATCH /api/cards/FRW-BL-040
    ok   - stub received body { status: "done" }
    ok   - tools/call (bad status) returns isError:true (no crash)
    6 passed, 0 failed

### Documented hook snippet — invoke the tool via mcp_tool (NOT wired)

This is the EXAMPLE of how a hook entry in .claude/settings.json would call the tool
once the server is registered as an MCP server named vldr-dashboard. It is
documentation only — do NOT add this to settings.json in this card. (mcp_tool hook
type requires CC >= 2.1.118.)

First, the server would be declared (e.g. in a pack .mcp.json, mirroring
framework/packs/MCP-GOVERNANCE.md conventions — CLAUDE_PROJECT_DIR path, ENV_VAR for
any secret, deferred i.e. NOT alwaysLoad):

    // (example) framework/packs/<pack>/.mcp.json — NOT added in this card
    {
      "$schema": "https://json.schemastore.org/mcp.json",
      "mcpServers": {
        "vldr-dashboard": {
          "command": "node",
          "args": ["${CLAUDE_PROJECT_DIR}/framework/research/mcp-dashboard-spike/poc/server.js"],
          "env": { "VLDR_API_URL": "${VLDR_API_URL}" },
          "description": "Typed dashboard writes (update_card_status, ...). Deferred — loaded on tool-search."
        }
      }
    }

Then a hook could invoke the tool by name (example — task-completed could move a card
to done via the tool instead of apiPatch):

    // (example) .claude/settings.json hooks entry — NOT added in this card
    {
      "hooks": {
        "TaskCompleted": [
          {
            "matcher": "*",
            "hooks": [
              {
                "type": "mcp_tool",
                "server": "vldr-dashboard",
                "tool": "update_card_status",
                "arguments": { "cardId": "${CARD_ID}", "status": "done" }
              }
            ]
          }
        ]
      }
    }

(Exact mcp_tool field names follow the running CC's hook schema; the shape above —
type: "mcp_tool", a server reference, a tool name, structured arguments — is the
intent. Validate against the live schema at migration time.)

---

## 6. Go / No-Go recommendation

### Verdict: NO-GO for a broad migration; conditional GO for a narrow, deferred skills-only pilot.

Scoped strictly to "no production migration in this card," the recommendation is:

Do NOT migrate the hook surface (the 80 vldr-api.js call-sites) to MCP. Reasons:

1. The headless-availability caveat is disqualifying for hooks. Hooks carry the
   highest-volume, must-not-drop writes (POST /api/events 28x, agent lifecycle,
   heartbeats). If an MCP server is absent in a headless/cron run, those writes
   vanish silently. The current always-available fetch path is strictly safer for
   unattended operation — Volundr's core use case.
2. No real win there. Hooks are code, already centralized in vldr-api.js, with no
   curl escaping to fix. MCP's benefit is model-facing discoverability, which hooks
   don't need.
3. Redundant with @vldr/sdk for typed access.

Conditional GO for a future, separate card: a narrow MCP wrapper over @vldr/sdk
exposing a handful of model-facing write tools (the ~14 skill/command write curls:
card status, economy toggle, directive CRUD, journal/event POST), shipped as a
deferred (non-alwaysLoad) pack server under the existing MCP-governance allowlist.
This is where typed tools + no-shell-quoting + /usage attribution actually pay off,
and it sidesteps the headless risk because skills/commands are interactive surfaces.

Gating conditions before that future GO:

- Live-verify the stdio server IS present in a headless run (the documented caveat).
- Implement it as an SDK consumer (not re-implemented HTTP).
- Resolve per-call projectId (active-project switching).
- Add vldr-dashboard to framework/packs/MCP-GOVERNANCE.md allowlist (vetting checklist).
- Capture a live /usage per-server reading to confirm the context cost is acceptable.

Net: the PoC proves it is feasible and cheap to build, but the cost/benefit says the
hook surface should stay on fetch; only the model-facing skill writes are worth
wrapping, and only after the headless caveat is verified.
