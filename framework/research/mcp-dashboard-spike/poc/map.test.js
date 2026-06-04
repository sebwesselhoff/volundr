// Pure-node test for the PoC tool-mapping logic. No deps, no network.
// Run:  node framework/research/mcp-dashboard-spike/poc/map.test.js
//
// Proves the `update_card_status` tool turns its args into exactly the request
// the dashboard's `PATCH /api/cards/:id` route already accepts — which is the
// load-bearing claim of the spike. The MCP-SDK transport is irrelevant to this.

'use strict';

const assert = require('assert');
const { mapUpdateCardStatus, VALID_STATUSES } = require('./map.js');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`ok   - ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL - ${name}\n       ${err.message}`);
  }
}

// 1. Happy path: maps to PATCH /api/cards/:id with { status } body.
t('maps a valid call to PATCH /api/cards/:id with { status } body', () => {
  const req = mapUpdateCardStatus({ cardId: 'FRW-BL-040', status: 'done', apiUrl: 'http://localhost:3141' });
  assert.strictEqual(req.method, 'PATCH');
  assert.strictEqual(req.url, 'http://localhost:3141/api/cards/FRW-BL-040');
  assert.deepStrictEqual(req.body, { status: 'done' });
  assert.strictEqual(req.headers['Content-Type'], 'application/json');
});

// 2. Trailing slash on apiUrl is normalised (no double slash).
t('normalises a trailing slash on apiUrl', () => {
  const req = mapUpdateCardStatus({ cardId: 'X-1', status: 'todo', apiUrl: 'http://host:3141/' });
  assert.strictEqual(req.url, 'http://host:3141/api/cards/X-1');
});

// 3. Default apiUrl falls back to the dashboard's well-known local port.
t('defaults apiUrl to http://localhost:3141 when omitted', () => {
  const saved = process.env.VLDR_API_URL;
  delete process.env.VLDR_API_URL;
  try {
    const req = mapUpdateCardStatus({ cardId: 'A1', status: 'review' });
    assert.strictEqual(req.url, 'http://localhost:3141/api/cards/A1');
  } finally {
    if (saved !== undefined) process.env.VLDR_API_URL = saved;
  }
});

// 4. Every documented status is accepted.
t('accepts every valid status', () => {
  for (const s of VALID_STATUSES) {
    const req = mapUpdateCardStatus({ cardId: 'C-1', status: s });
    assert.deepStrictEqual(req.body, { status: s });
  }
});

// 5. Rejects an unknown status (would otherwise be a silent API no-op).
t('rejects an unknown status', () => {
  assert.throws(() => mapUpdateCardStatus({ cardId: 'C-1', status: 'finished' }), /must be one of/);
});

// 6. Rejects a missing cardId.
t('rejects a missing cardId', () => {
  assert.throws(() => mapUpdateCardStatus({ status: 'done' }), /cardId.*required/);
});

// 7. Rejects a cardId with path-injection characters (the curl-escaping risk class).
t('rejects a cardId with injection characters', () => {
  assert.throws(() => mapUpdateCardStatus({ cardId: '../../etc/passwd', status: 'done' }), /invalid characters/);
  assert.throws(() => mapUpdateCardStatus({ cardId: 'a b', status: 'done' }), /invalid characters/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
