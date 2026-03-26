---
name: "WebSocket & Real-Time Patterns"
description: "WebSocket lifecycle, connection management, broadcast patterns, and reconnection strategies"
domain: "backend"
confidence: "medium"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "websocket"
  - "realtime"
  - "real-time"
  - "ws"
  - "broadcast"
  - "reconnect"
  - "socket"
  - "push"
roles:
  - "developer"
  - "architect"
---

## Context
Apply when implementing real-time features (live updates, agent status feeds, collaborative
editing). WebSockets are appropriate when the server needs to push data to clients without polling.

## Patterns

**Connection registry — track clients with metadata:**
```typescript
const clients = new Map<WebSocket, { projectId: string; agentId?: string }>();

wss.on('connection', (ws, req) => {
  const projectId = parseProjectFromUrl(req.url);
  clients.set(ws, { projectId });
  ws.on('close', () => clients.delete(ws));
});
```

**Broadcast to a subset — filter by metadata:**
```typescript
function broadcastToProject(projectId: string, msg: object) {
  const payload = JSON.stringify(msg);
  for (const [ws, meta] of clients) {
    if (meta.projectId === projectId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
```

**Heartbeat / ping-pong — detect dead connections:**
```typescript
setInterval(() => {
  for (const [ws] of clients) {
    if (!ws['isAlive']) { ws.terminate(); clients.delete(ws); return; }
    ws['isAlive'] = false;
    ws.ping();
  }
}, 30_000);
ws.on('pong', () => { ws['isAlive'] = true; });
```

**Client reconnect with exponential backoff:**
```typescript
let delay = 1000;
function reconnect() {
  ws = new WebSocket(url);
  ws.onclose = () => { setTimeout(reconnect, delay); delay = Math.min(delay * 2, 30_000); };
  ws.onopen = () => { delay = 1000; };
}
```

**Message envelope — typed payloads:**
```json
{ "type": "agent.status", "agentId": "a-001", "status": "running", "timestamp": "..." }
```

## Examples

```typescript
// Send mutation broadcast after DB write
router.post('/skills', (req, res) => {
  const skill = db.createSkill(req.body);
  broadcastToBrowsers({ type: 'skill.created', skill });
  res.status(201).json(skill);
});
```

## Anti-Patterns

- **No connection cleanup** — leaked connections accumulate; always handle `close` and `error` events
- **Broadcasting to all clients** — filter by project/session to avoid data leaks
- **Unbounded message queues** — if a client is slow, cap the queue to avoid memory growth
- **WebSockets for request-response patterns** — use HTTP for request/response; WebSockets for push
- **No reconnect logic on the client** — transient network errors will disconnect clients permanently
