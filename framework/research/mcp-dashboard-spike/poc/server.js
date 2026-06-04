#!/usr/bin/env node
// PoC: minimal stdio MCP server wrapping the Volundr dashboard.
//
// SPIKE SCOPE — this is a proof of concept, NOT production wiring:
//   * It is hand-rolled JSON-RPC 2.0 over newline-delimited stdin/stdout so it
//     runs with ZERO npm dependencies (so the spike can be executed today). A
//     production server would instead depend on `@modelcontextprotocol/sdk`
//     (Server + StdioServerTransport) for spec-complete framing, capability
//     negotiation, notifications, and forward-compat. We deliberately do NOT
//     add that dep to any package.json in this card.
//   * It exposes ONE dashboard WRITE — `update_card_status` — which maps to the
//     dashboard's existing `PATCH /api/cards/:id` route (the same call
//     @vldr/sdk CardsResource.update and several hooks make today).
//
// Run (manual smoke):  node framework/research/mcp-dashboard-spike/poc/server.js
//   then paste JSON-RPC frames on stdin, e.g.
//   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
//   {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
//   {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"update_card_status","arguments":{"cardId":"FRW-BL-040","status":"done"}}}
//
// The framing/dispatch is also exercised headlessly by harness.test.js, which
// pipes those exact frames and asserts the responses (no real network needed —
// it points apiUrl at a throwaway local stub).

'use strict';

const readline = require('readline');
const { mapUpdateCardStatus, VALID_STATUSES } = require('./map.js');

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'update_card_status',
    description:
      'Update a Volundr dashboard card status. Maps to PATCH /api/cards/:id. ' +
      'Use to move a card between backlog/todo/in_progress/review/blocked/done.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'Card id, e.g. FRW-BL-040' },
        status: { type: 'string', enum: VALID_STATUSES, description: 'Target status' },
      },
      required: ['cardId', 'status'],
    },
  },
];

// Perform the dashboard write. Uses global fetch (Node >= 18, which the repo
// already requires for the hooks' fetch-based vldr-api.js).
async function callUpdateCardStatus(args) {
  const reqDesc = mapUpdateCardStatus(args); // throws on bad input
  const res = await fetch(reqDesc.url, {
    method: reqDesc.method,
    headers: reqDesc.headers,
    body: JSON.stringify(reqDesc.body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`dashboard returned HTTP ${res.status}: ${text}`);
  }
  return text;
}

function jsonrpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  // Notifications (no id) get no response, per JSON-RPC.
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonrpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'vldr-dashboard-spike', version: '0.0.0-poc' },
      });

    case 'notifications/initialized':
      return null; // notification, no reply

    case 'tools/list':
      return jsonrpcResult(id, { tools: TOOLS });

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name !== 'update_card_status') {
        return jsonrpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const body = await callUpdateCardStatus(args);
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: body }],
          isError: false,
        });
      } catch (err) {
        // MCP convention: tool failures are returned as isError content, not
        // protocol errors, so the model can read and react to them.
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: String(err && err.message ? err.message : err) }],
          isError: true,
        });
      }
    }

    default:
      if (id === undefined) return null; // unknown notification
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stdout.write(jsonrpcError(null, -32700, 'Parse error') + '\n');
      return;
    }
    const out = await handle(msg);
    if (out !== null && out !== undefined) process.stdout.write(out + '\n');
  });
}

// Export the dispatcher for headless testing; only start the loop when run direct.
module.exports = { handle, TOOLS, PROTOCOL_VERSION };
if (require.main === module) main();
