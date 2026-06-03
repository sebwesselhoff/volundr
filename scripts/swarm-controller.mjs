#!/usr/bin/env node
/**
 * swarm-controller.mjs — dynamic-swarm DECISION LOGIC for mid-round reassignment,
 * card injection, and replan triggering (FRW-BL-066).
 *
 * Today Volundr's round model is static: teammates are assigned a domain's cards at the
 * start of a round and sit IDLE once those cards are done, doing nothing until the round
 * boundary, when Volundr re-plans the next batch. Shannon-style dynamic swarms instead
 * RECYCLE an idle agent onto newly-available work immediately, INJECT cards discovered
 * mid-run into the schedulable set, and ESCALATE blocker messages into an immediate replan
 * rather than waiting for the next boundary.
 *
 * This module is PURE DECISION LOGIC — the same shape as scripts/loop-controller.mjs: a set
 * of side-effect-free, closure/object functions that Volundr's orchestration loop CONSULTS.
 * It does NOT spawn processes, hold a live teammate runtime, or do I/O. Volundr's loop owns
 * the runtime; it calls these functions to decide WHAT to do, then performs the action.
 *
 * Crucially the dynamic machinery is a STRICT NO-OP when there is no dynamic work: with no
 * idle-teammate-with-an-available-target, no injected/discovered cards, and no blocker
 * messages, `roundBoundaryPreserved` returns true and normal round-boundary semantics are
 * unchanged — dynamic spawning never perturbs a round that has nothing dynamic to do.
 *
 * Pure Node, no external deps. Exported functions are pure so they unit-test without I/O.
 * Self-test: scripts/swarm-controller.test.mjs.
 */

/**
 * Project-wide defaults for the swarm decision logic.
 *
 * - `tieBreak`: how to choose among equally-preferred reassignment candidates.
 *   'lowest-id' (default) takes the lexicographically/numerically smallest card id;
 *   'highest-priority' takes the largest `priority` (higher number = more urgent).
 * - `blockerKeywords`: substrings (case-insensitive) that classify a free-text message as a
 *   structural blocker when no explicit `type` field is present.
 *
 * @type {Readonly<{tieBreak: 'lowest-id'|'highest-priority', blockerKeywords: ReadonlyArray<string>}>}
 */
export const DEFAULTS = Object.freeze({
  tieBreak: 'lowest-id',
  blockerKeywords: Object.freeze([
    'blocked',
    'blocker',
    'cannot proceed',
    "can't proceed",
    'unblock',
    'dependency missing',
    'missing dependency',
    'needs replan',
    'replan',
    'escalate',
  ]),
});

/* -------------------------------------------------------------------------- */
/* ISC-1: idle-teammate reassignment                                          */
/* -------------------------------------------------------------------------- */

/**
 * Stable, deterministic card-id comparator for "lowest id" tie-breaking. Compares the numeric
 * suffix of ids that share a prefix (so FRW-BL-9 sorts before FRW-BL-10), and falls back to a
 * plain string compare otherwise. Pure.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, positive if a > b, 0 if equal
 */
function compareCardIds(a, b) {
  const sa = String(a == null ? '' : a);
  const sb = String(b == null ? '' : b);
  const ma = sa.match(/^(.*?)(\d+)$/);
  const mb = sb.match(/^(.*?)(\d+)$/);
  if (ma && mb && ma[1] === mb[1]) {
    const na = Number(ma[2]);
    const nb = Number(mb[2]);
    if (na !== nb) return na - nb;
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Pick the best newly-unblocked card an IDLE teammate can take THIS round, recycling the
 * teammate instead of letting it sit idle to the round boundary (ISC-1).
 *
 * Selection policy (in order):
 *   1. Candidates are the `newlyUnblockedCards` that are actually takeable: not already
 *      assigned/owned, not completed, and (defensively) not themselves still blocked.
 *   2. Prefer a DOMAIN MATCH — a card whose domain (`domainOf(card)`, falling back to
 *      `card.domain`) equals `idleTeammate.domain`. If any domain-matched candidate exists,
 *      only those are considered (a teammate is recycled onto its own domain first).
 *   3. Tie-break within the chosen set by `tieBreak`: 'lowest-id' (default, deterministic) or
 *      'highest-priority' (largest `priority`, lowest-id as a secondary tiebreak).
 *
 * Returns the chosen card object, or `null` when there is nothing the teammate can take
 * (empty/absent list, or every candidate is already taken/completed/blocked).
 *
 * @param {{
 *   idleTeammate?: {domain?: string, name?: string},
 *   newlyUnblockedCards?: Array<{id: string, domain?: string, priority?: number, status?: string, assignedTo?: string, owner?: string, blockedBy?: Array<string>}>,
 *   domainOf?: (card: object) => (string|undefined),
 *   tieBreak?: 'lowest-id'|'highest-priority',
 * }} [args]
 * @returns {object|null} the selected card, or null if none is takeable
 */
export function selectReassignmentTarget({
  idleTeammate = {},
  newlyUnblockedCards = [],
  domainOf,
  tieBreak = DEFAULTS.tieBreak,
} = {}) {
  if (!Array.isArray(newlyUnblockedCards) || newlyUnblockedCards.length === 0) return null;

  const domainFn =
    typeof domainOf === 'function' ? domainOf : (card) => (card == null ? undefined : card.domain);

  // 1. Takeable = not already owned/assigned, not completed, not still blocked.
  const takeable = newlyUnblockedCards.filter((card) => {
    if (card == null || card.id == null) return false;
    const status = String(card.status || '').toLowerCase();
    if (status === 'completed' || status === 'in_progress' || status === 'done') return false;
    if (card.assignedTo != null && card.assignedTo !== '') return false;
    if (card.owner != null && card.owner !== '') return false;
    if (Array.isArray(card.blockedBy) && card.blockedBy.length > 0) return false;
    return true;
  });
  if (takeable.length === 0) return null;

  // 2. Prefer domain match. If any candidate matches the idle teammate's domain, restrict to those.
  const wantDomain = idleTeammate == null ? undefined : idleTeammate.domain;
  let pool = takeable;
  if (wantDomain != null && wantDomain !== '') {
    const matched = takeable.filter((card) => domainFn(card) === wantDomain);
    if (matched.length > 0) pool = matched;
  }

  // 3. Tie-break within the chosen pool. Deterministic regardless of input order.
  const byLowestId = (a, b) => compareCardIds(a.id, b.id);
  const sorted = pool.slice().sort((a, b) => {
    if (tieBreak === 'highest-priority') {
      const pa = Number.isFinite(a.priority) ? a.priority : 0;
      const pb = Number.isFinite(b.priority) ? b.priority : 0;
      if (pa !== pb) return pb - pa; // higher priority first
    }
    return byLowestId(a, b);
  });

  return sorted[0] || null;
}

/* -------------------------------------------------------------------------- */
/* ISC-2: mid-round card injection                                            */
/* -------------------------------------------------------------------------- */

/**
 * Inject a card discovered MID-ROUND into the schedulable set, returning a NEW round state
 * (the input is never mutated) (ISC-2).
 *
 * The discovered card is appended to `roundState.schedulable` and recorded in
 * `roundState.discovered` (so the loop can tell injected work apart from the original batch,
 * which `hasDynamicWork`/`roundBoundaryPreserved` rely on). Dedupe is by `id`: re-injecting a
 * card already present in either list is a no-op (a fresh, equal copy is returned — still a new
 * object, still no mutation of the input).
 *
 * @param {{schedulable?: Array<{id: string}>, discovered?: Array<{id: string}>}} roundState
 * @param {{id: string}} discoveredCard the card discovered mid-round
 * @returns {{schedulable: Array<{id: string}>, discovered: Array<{id: string}>}} a NEW round state
 */
export function injectCard(roundState, discoveredCard) {
  const base = roundState && typeof roundState === 'object' ? roundState : {};
  const schedulable = Array.isArray(base.schedulable) ? base.schedulable.slice() : [];
  const discovered = Array.isArray(base.discovered) ? base.discovered.slice() : [];

  // Preserve any other keys on the round state without mutating the original object.
  const next = { ...base, schedulable, discovered };

  if (discoveredCard == null || discoveredCard.id == null) return next;

  const alreadyScheduled = schedulable.some((c) => c && c.id === discoveredCard.id);
  if (alreadyScheduled) return next; // dedupe: no-op (new state, no mutation)

  schedulable.push(discoveredCard);
  if (!discovered.some((c) => c && c.id === discoveredCard.id)) {
    discovered.push(discoveredCard);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* ISC-3: blocker-message → replan trigger                                    */
/* -------------------------------------------------------------------------- */

/**
 * Classify a teammate message as 'blocker' | 'status' | 'other' (ISC-3).
 *
 * An explicit `type` field wins ('blocker'/'blocked' → 'blocker'; 'status'/'progress' →
 * 'status'). Otherwise the message TEXT (a string, or `message.text`/`message.summary`) is
 * scanned for blocker keywords (DEFAULTS.blockerKeywords) → 'blocker'; for status keywords
 * ('status', 'progress', 'update', 'done', 'completed', 'passed') → 'status'; else 'other'.
 *
 * @param {string|{type?: string, text?: string, summary?: string}} message
 * @returns {'blocker'|'status'|'other'}
 */
export function classifyMessage(message) {
  if (message == null) return 'other';

  // Explicit type wins.
  if (typeof message === 'object') {
    const t = String(message.type || '').toLowerCase();
    if (t === 'blocker' || t === 'blocked') return 'blocker';
    if (t === 'status' || t === 'progress') return 'status';
  }

  const text =
    typeof message === 'string'
      ? message
      : String((message && (message.text || message.summary)) || '');
  const lower = text.toLowerCase();

  if (DEFAULTS.blockerKeywords.some((kw) => lower.includes(kw))) return 'blocker';

  const statusKeywords = ['status', 'progress', 'update', 'done', 'completed', 'passed', 'on track'];
  if (statusKeywords.some((kw) => lower.includes(kw))) return 'status';

  return 'other';
}

/**
 * True iff a message is a blocker — a blocker-type message auto-triggers a replanning step
 * (ISC-3). Volundr's loop calls this on each inbound teammate message; a true result means the
 * loop should run a replan (re-derive the unblocked set / re-plan assignments) immediately
 * rather than waiting for the round boundary.
 *
 * @param {string|{type?: string, text?: string, summary?: string}} message
 * @returns {boolean}
 */
export function shouldReplan(message) {
  return classifyMessage(message) === 'blocker';
}

/* -------------------------------------------------------------------------- */
/* ISC-4: dynamic-work detection / round-boundary preservation                */
/* -------------------------------------------------------------------------- */

/**
 * Does this round state contain any DYNAMIC work — i.e. is there anything for the dynamic
 * machinery to do before the round boundary? Dynamic work is ANY of:
 *   - an idle teammate that has an available reassignment target (selectReassignmentTarget
 *     would return non-null), OR
 *   - injected/discovered cards (`roundState.discovered` non-empty), OR
 *   - any inbound message that classifies as a blocker (would trigger a replan).
 *
 * Pure: re-uses selectReassignmentTarget / classifyMessage; no I/O, no mutation.
 *
 * @param {{
 *   idleTeammates?: Array<{domain?: string}>,
 *   newlyUnblockedCards?: Array<object>,
 *   discovered?: Array<object>,
 *   messages?: Array<object|string>,
 *   domainOf?: (card: object) => (string|undefined),
 *   tieBreak?: 'lowest-id'|'highest-priority',
 * }} [roundState]
 * @returns {boolean}
 */
export function hasDynamicWork(roundState = {}) {
  const {
    idleTeammates = [],
    newlyUnblockedCards = [],
    discovered = [],
    messages = [],
    domainOf,
    tieBreak = DEFAULTS.tieBreak,
  } = roundState || {};

  // Injected/discovered cards present?
  if (Array.isArray(discovered) && discovered.length > 0) return true;

  // Any blocker message present?
  if (Array.isArray(messages) && messages.some((m) => classifyMessage(m) === 'blocker')) return true;

  // Any idle teammate with an available reassignment target?
  if (Array.isArray(idleTeammates) && idleTeammates.length > 0) {
    for (const idleTeammate of idleTeammates) {
      const target = selectReassignmentTarget({
        idleTeammate,
        newlyUnblockedCards,
        domainOf,
        tieBreak,
      });
      if (target != null) return true;
    }
  }

  return false;
}

/**
 * Round-boundary preservation guarantee (ISC-4). Returns true when there is NO dynamic work —
 * meaning the dynamic machinery is a strict NO-OP and normal round-boundary semantics are
 * unchanged. Returns false when dynamic work exists (the loop will act mid-round instead of
 * waiting for the boundary).
 *
 * `roundBoundaryPreserved(state) === !hasDynamicWork(state)` by construction — it is the
 * explicit, named guarantee Volundr's loop checks to confirm a round behaves exactly as the
 * static model when nothing dynamic is pending.
 *
 * @param {Parameters<typeof hasDynamicWork>[0]} [roundState]
 * @returns {boolean} true iff the round has no dynamic work (boundary semantics preserved)
 */
export function roundBoundaryPreserved(roundState = {}) {
  return !hasDynamicWork(roundState);
}
