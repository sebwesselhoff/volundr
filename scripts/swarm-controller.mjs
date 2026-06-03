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
 * - `blockerKeywords`: whole-word patterns (case-insensitive) that classify a free-text message
 *   as a structural blocker when no explicit `type` field is present. Each entry is tested as a
 *   complete word or phrase boundary using `\b` anchors so that partial matches like "replan" in
 *   "no replan needed" or "escalate" in "escalate privileges" do NOT trigger. Only unambiguous
 *   blocker phrasing (the word/phrase as a whole unit in context) classifies as a blocker.
 *
 * @type {Readonly<{tieBreak: 'lowest-id'|'highest-priority', blockerKeywords: ReadonlyArray<string>}>}
 */
export const DEFAULTS = Object.freeze({
  tieBreak: 'lowest-id',
  // Each keyword is matched as a WHOLE WORD / phrase (word-boundary anchored).
  // Multi-word phrases: boundaries anchored at the first and last word character of the phrase.
  // Chosen for unambiguity: each phrase is only naturally produced in a genuine blocker context.
  blockerKeywords: Object.freeze([
    'blocked',        // "I am blocked", "card is blocked" — but NOT "unblocked"
    'blocker',        // "this is a blocker" — standalone noun
    'cannot proceed', // literal phrase, unambiguous
    "can't proceed",  // contraction form
    'needs replan',   // "the plan needs replan" — explicit request, not "no replan needed"
    'must escalate',  // directive form only — not bare "escalate"
    'dependency missing', // "a dependency missing" — not "missing" alone
    'stuck on',       // "stuck on auth" — unambiguous
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

  // 1. Takeable = not already owned/assigned, not completed/in_progress/done/assigned, not still blocked.
  const NON_TAKEABLE_STATUSES = new Set(['completed', 'in_progress', 'done', 'assigned']);
  const takeable = newlyUnblockedCards.filter((card) => {
    if (card == null || card.id == null) return false;
    const status = String(card.status || '').toLowerCase();
    if (NON_TAKEABLE_STATUSES.has(status)) return false;
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

  // Dedupe by id against BOTH schedulable and discovered lists.
  // A card already recorded in EITHER list is not added again to that list.
  // If a card is in discovered but not schedulable it is still considered known — no re-add.
  const alreadyScheduled = schedulable.some((c) => c && c.id === discoveredCard.id);
  const alreadyDiscovered = discovered.some((c) => c && c.id === discoveredCard.id);

  // No-op if the card is already fully accounted for in both lists.
  if (alreadyScheduled && alreadyDiscovered) return next;

  // Add to schedulable only when not already present in either list (prevents duplicate scheduled work).
  if (!alreadyScheduled && !alreadyDiscovered) schedulable.push(discoveredCard);
  if (!alreadyDiscovered) discovered.push(discoveredCard);
  return next;
}

/* -------------------------------------------------------------------------- */
/* ISC-3: blocker-message → replan trigger                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a whole-word regex for a keyword or phrase. For single words the pattern is `\bword\b`.
 * For multi-word phrases the first and last word-characters are \b-anchored; interior spaces are
 * matched as `\s+` so "can't proceed" matches regardless of whitespace variant.
 *
 * @param {string} kw
 * @returns {RegExp}
 */
function buildKeywordRegex(kw) {
  // Escape regex metacharacters in the keyword, then replace spaces with \s+ for phrase flexibility.
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

// Pre-compile keyword regexes once so classifyMessage stays a pure, allocation-light hot path.
const BLOCKER_REGEXES = DEFAULTS.blockerKeywords.map(buildKeywordRegex);
const STATUS_KEYWORDS_RE = /\b(?:status|progress|update|done|completed|passed|on\s+track)\b/i;

/**
 * Classify a teammate message as 'blocker' | 'status' | 'other' (ISC-3).
 *
 * An explicit `type` field ALWAYS wins over text scanning (in both directions):
 *   - type 'blocker'/'blocked' → 'blocker' (even if text says "all good")
 *   - type 'status'/'progress' → 'status' (even if text contains a blocker keyword)
 *
 * Otherwise the message TEXT (a string, or `message.text`/`message.summary`) is scanned using
 * WHOLE-WORD matching (word-boundary anchored regexes) against DEFAULTS.blockerKeywords. This
 * prevents partial/embedded matches: "no replan needed today" does NOT match "needs replan";
 * "escalate privileges" does NOT match "must escalate". Only unambiguous blocker phrasing
 * (the keyword/phrase as a whole word unit) classifies as 'blocker'. Status keywords are also
 * whole-word matched. Anything else is 'other'.
 *
 * @param {string|{type?: string, text?: string, summary?: string}} message
 * @returns {'blocker'|'status'|'other'}
 */
export function classifyMessage(message) {
  if (message == null) return 'other';

  // Explicit type field wins — checked BEFORE text scanning, in both directions.
  if (typeof message === 'object') {
    const t = String(message.type || '').toLowerCase();
    if (t === 'blocker' || t === 'blocked') return 'blocker';
    if (t === 'status' || t === 'progress') return 'status';
  }

  const text =
    typeof message === 'string'
      ? message
      : String((message && (message.text || message.summary)) || '');

  // Whole-word blocker keyword scan (pre-compiled regexes, word-boundary anchored).
  if (BLOCKER_REGEXES.some((re) => re.test(text))) return 'blocker';

  // Whole-word status keyword scan.
  if (STATUS_KEYWORDS_RE.test(text)) return 'status';

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
