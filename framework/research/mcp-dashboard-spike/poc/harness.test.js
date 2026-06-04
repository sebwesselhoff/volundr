// End-to-end harness for the PoC stdio MCP server, with ZERO external deps.
// Run:  node framework/research/mcp-dashboard-spike/poc/harness.test.js
//
// What it proves:
//   1. The hand-rolled JSON-RPC stdio framing works: initialize -> tools/list
//      -> tools/call round-trip over real stdin/stdout of a child process.
//   2. tools/call(update_card_status) issues a real PATCH /api/cards/:id to a
//      throwaway local HTTP stub, and the stub receives exactly { status }.
//   3. A bad status comes back as an MCP isError result, not a crash.
//
// No MCP SDK and no live dashboard are required: the stub stands in for the API
// so the spike is runnable on any machine.

'use strict';

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`ok   - ${name}`); }
  else { fail++; console.log(`FAIL - ${name}`); }
}

function startStub() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      // Mimic the dashboard's PATCH response: the updated card JSON.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const id = decodeURIComponent(req.url.replace('/api/cards/', ''));
      res.end(JSON.stringify({ id, status: body ? JSON.parse(body).status : null }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
  });
}

function runServerWithFrames(apiUrl, frames) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, VLDR_API_URL: apiUrl },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('error', reject);
    child.on('close', () => {
      const lines = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      resolve(lines);
    });
    for (const f of frames) child.stdin.write(JSON.stringify(f) + '\n');
    child.stdin.end();
  });
}

(async () => {
  const { server, received, port } = await startStub();
  const apiUrl = `http://127.0.0.1:${port}`;

  const responses = await runServerWithFrames(apiUrl, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'update_card_status', arguments: { cardId: 'FRW-BL-040', status: 'done' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'update_card_status', arguments: { cardId: 'FRW-BL-040', status: 'nope' } } },
  ]);

  const byId = Object.fromEntries(responses.map((r) => [r.id, r]));

  ok('initialize returns serverInfo + protocolVersion', !!(byId[1] && byId[1].result && byId[1].result.serverInfo && byId[1].result.protocolVersion));
  ok('tools/list advertises update_card_status', !!(byId[2] && byId[2].result && byId[2].result.tools.some((t) => t.name === 'update_card_status')));
  ok('tools/call (valid) returns isError:false', !!(byId[3] && byId[3].result && byId[3].result.isError === false));
  ok('stub received exactly one PATCH /api/cards/FRW-BL-040', received.length === 1 && received[0].method === 'PATCH' && received[0].url === '/api/cards/FRW-BL-040');
  ok('stub received body { status: "done" }', received.length === 1 && JSON.stringify(received[0].body) === JSON.stringify({ status: 'done' }));
  ok('tools/call (bad status) returns isError:true (no crash)', !!(byId[4] && byId[4].result && byId[4].result.isError === true));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
