// PoC: pure-node request-mapping logic for the `update_card_status` MCP tool.
//
// This module contains ZERO MCP-SDK and ZERO network code on purpose: it is the
// piece of the spike that is unit-testable in plain Node, and it is the piece
// that actually matters for correctness — turning a tool call into the exact
// HTTP request the dashboard's `PATCH /api/cards/:id` route already expects
// (see dashboard/packages/api/src/routes/cards.ts and the @vldr/sdk
// CardsResource.update which does `http.patch('/api/cards/${cardId}', data)`).
//
// Keeping this separate from the transport means the spike's go/no-go does not
// hinge on installing @modelcontextprotocol/sdk: we can prove the mapping is
// right today, and the SDK only wires stdin/stdout JSON-RPC around it later.

'use strict';

// The card statuses the dashboard recognises (mirrors the values the PATCH
// route + UI use). The MCP tool surface should validate here so a bad status
// never reaches the API as a silent no-op.
const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];

const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Map an `update_card_status` tool call to an HTTP request descriptor.
 *
 * @param {{ cardId?: string, status?: string, apiUrl?: string }} args
 * @returns {{ method: string, url: string, headers: Record<string,string>, body: object }}
 * @throws {Error} on invalid input (the MCP server turns this into an isError result)
 */
function mapUpdateCardStatus(args) {
  const a = args || {};
  const apiUrl = (a.apiUrl || process.env.VLDR_API_URL || 'http://localhost:3141').replace(/\/$/, '');

  if (typeof a.cardId !== 'string' || a.cardId.trim() === '') {
    throw new Error('update_card_status: "cardId" is required and must be a non-empty string');
  }
  if (!CARD_ID_RE.test(a.cardId)) {
    // Defends the path segment — no URL-injection via the id, no curl-escaping games.
    throw new Error(`update_card_status: "cardId" has invalid characters: ${a.cardId}`);
  }
  if (typeof a.status !== 'string' || !VALID_STATUSES.includes(a.status)) {
    throw new Error(
      `update_card_status: "status" must be one of ${VALID_STATUSES.join(', ')} (got ${JSON.stringify(a.status)})`
    );
  }

  return {
    method: 'PATCH',
    // encodeURIComponent is belt-and-suspenders; the regex already constrains the id.
    url: `${apiUrl}/api/cards/${encodeURIComponent(a.cardId)}`,
    headers: { 'Content-Type': 'application/json' },
    // Body shape matches UpdateCardInput / the route's destructured `{ status }`.
    body: { status: a.status },
  };
}

module.exports = { mapUpdateCardStatus, VALID_STATUSES };
