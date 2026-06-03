// Self-test for swarm-controller.mjs (FRW-BL-066). Run: node scripts/swarm-controller.test.mjs
import {
  selectReassignmentTarget,
  injectCard,
  classifyMessage,
  shouldReplan,
  hasDynamicWork,
  roundBoundaryPreserved,
  DEFAULTS,
} from './swarm-controller.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('swarm-controller self-test\n');

/* --- ISC-1: idle-teammate reassignment ------------------------------------ */

// Reassignment PREFERS a domain match even when an off-domain card has a lower id.
const idleBackend = { name: 'dev-1', domain: 'backend' };
const cardsMixed = [
  { id: 'FRW-BL-010', domain: 'frontend' },
  { id: 'FRW-BL-020', domain: 'backend' },
  { id: 'FRW-BL-030', domain: 'backend' },
];
const picked = selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: cardsMixed });
ok('reassignment prefers domain match (backend, not the lower-id frontend card)',
  picked != null && picked.id === 'FRW-BL-020' && picked.domain === 'backend');

// Within the domain-matched set, tie-break is lowest id (deterministic regardless of order).
const reordered = [cardsMixed[2], cardsMixed[1], cardsMixed[0]];
const picked2 = selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: reordered });
ok('domain tie-break = lowest id, order-independent', picked2 != null && picked2.id === 'FRW-BL-020');

// No domain match → fall back to ANY takeable card (lowest id).
const idleData = { name: 'dev-2', domain: 'data' };
const pickedFallback = selectReassignmentTarget({ idleTeammate: idleData, newlyUnblockedCards: cardsMixed });
ok('no domain match → falls back to lowest-id takeable card', pickedFallback != null && pickedFallback.id === 'FRW-BL-010');

// domainOf accessor is honored over a raw card.domain field.
const cardsNoDomainField = [
  { id: 'C-1' },
  { id: 'C-2' },
];
const domainOf = (c) => (c.id === 'C-2' ? 'backend' : 'frontend');
const pickedViaFn = selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: cardsNoDomainField, domainOf });
ok('domainOf(card) accessor used for matching', pickedViaFn != null && pickedViaFn.id === 'C-2');

// highest-priority tie-break selects the most urgent within the domain pool.
const cardsPrio = [
  { id: 'P-1', domain: 'backend', priority: 1 },
  { id: 'P-2', domain: 'backend', priority: 9 },
  { id: 'P-3', domain: 'backend', priority: 5 },
];
const pickedPrio = selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: cardsPrio, tieBreak: 'highest-priority' });
ok('tieBreak=highest-priority picks largest priority', pickedPrio != null && pickedPrio.id === 'P-2');

// Returns null when there are NO unblocked cards.
ok('returns null on empty newlyUnblockedCards', selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: [] }) === null);
ok('returns null when newlyUnblockedCards omitted', selectReassignmentTarget({ idleTeammate: idleBackend }) === null);
ok('returns null on no args', selectReassignmentTarget() === null);

// Already-owned / completed / still-blocked cards are NOT takeable.
const cardsNotTakeable = [
  { id: 'X-1', domain: 'backend', assignedTo: 'dev-9' },
  { id: 'X-2', domain: 'backend', status: 'completed' },
  { id: 'X-3', domain: 'backend', blockedBy: ['X-1'] },
  { id: 'X-4', domain: 'backend', owner: 'dev-7' },
];
ok('skips owned/completed/blocked cards → null when none takeable',
  selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: cardsNotTakeable }) === null);

// Mixed: one genuinely takeable among non-takeable → it is chosen.
const cardsOneTakeable = [...cardsNotTakeable, { id: 'X-5', domain: 'backend' }];
const pickedOne = selectReassignmentTarget({ idleTeammate: idleBackend, newlyUnblockedCards: cardsOneTakeable });
ok('chooses the single takeable card among non-takeable ones', pickedOne != null && pickedOne.id === 'X-5');

/* --- ISC-2: mid-round card injection -------------------------------------- */

const roundState = { schedulable: [{ id: 'A' }, { id: 'B' }], discovered: [] };
const injected = injectCard(roundState, { id: 'C' });
ok('injectCard adds the discovered card to schedulable', injected.schedulable.some((c) => c.id === 'C'));
ok('injectCard records it in discovered', injected.discovered.some((c) => c.id === 'C'));
ok('injectCard does NOT mutate input schedulable', roundState.schedulable.length === 2 && !roundState.schedulable.some((c) => c.id === 'C'));
ok('injectCard does NOT mutate input discovered', roundState.discovered.length === 0);
ok('injectCard returns a NEW object', injected !== roundState && injected.schedulable !== roundState.schedulable);

// Dedupe by id: re-injecting an already-present card is a no-op (still new state, no mutation).
const injectedDup = injectCard(injected, { id: 'C' });
ok('injectCard dedupes by id (no duplicate in schedulable)', injectedDup.schedulable.filter((c) => c.id === 'C').length === 1);
ok('injectCard dedupe still returns a new object (no mutation)', injectedDup !== injected);

// Dedupe against an existing original (non-discovered) card too.
const injectedExisting = injectCard(roundState, { id: 'A' });
ok('injectCard dedupes against original schedulable card', injectedExisting.schedulable.filter((c) => c.id === 'A').length === 1);

// Tolerates empty / absent round state and null card.
ok('injectCard on empty state creates schedulable+discovered', (() => { const r = injectCard({}, { id: 'Z' }); return r.schedulable.length === 1 && r.discovered.length === 1; })());
ok('injectCard with null card → no-op new state', (() => { const r = injectCard(roundState, null); return r.schedulable.length === 2 && r !== roundState; })());

// Preserves unrelated round-state keys without mutation.
const richState = { schedulable: [{ id: 'A' }], discovered: [], round: 4, lead: 'volundr' };
const richInjected = injectCard(richState, { id: 'Q' });
ok('injectCard preserves unrelated keys (round, lead)', richInjected.round === 4 && richInjected.lead === 'volundr');

/* --- ISC-3: blocker-message → replan -------------------------------------- */

ok('classifyMessage: explicit type=blocker → blocker', classifyMessage({ type: 'blocker', text: 'x' }) === 'blocker');
ok('classifyMessage: explicit type=status → status', classifyMessage({ type: 'status', text: 'x' }) === 'status');
ok('classifyMessage: text "blocked on dep" → blocker', classifyMessage('I am blocked on the auth dependency') === 'blocker');
ok('classifyMessage: text "cannot proceed" → blocker', classifyMessage('cannot proceed without the schema') === 'blocker');
ok('classifyMessage: status text → status', classifyMessage('progress update: card 3 done') === 'status');
ok('classifyMessage: neutral text → other', classifyMessage('hello team, good morning') === 'other');
ok('classifyMessage: null → other (no throw)', classifyMessage(null) === 'other');
ok('classifyMessage: reads message.summary field', classifyMessage({ summary: 'blocker: missing dependency' }) === 'blocker');

ok('shouldReplan: true on blocker message', shouldReplan('we are blocked, needs replan') === true);
ok('shouldReplan: true on explicit blocker type', shouldReplan({ type: 'blocker' }) === true);
ok('shouldReplan: false on status message', shouldReplan('status: on track') === false);
ok('shouldReplan: false on other message', shouldReplan('just checking in') === false);
ok('shouldReplan: false on null', shouldReplan(null) === false);

/* --- ISC-4: dynamic-work / round-boundary preservation -------------------- */

// NO dynamic work → no-op → roundBoundaryPreserved true, hasDynamicWork false.
const staticRound = {
  idleTeammates: [{ domain: 'backend' }],
  newlyUnblockedCards: [],   // nothing to reassign onto
  discovered: [],            // nothing injected
  messages: ['status: all on track'], // no blockers
};
ok('hasDynamicWork false when no idle-target / no discovered / no blockers', hasDynamicWork(staticRound) === false);
ok('roundBoundaryPreserved true (no-op) for a static round', roundBoundaryPreserved(staticRound) === true);
ok('roundBoundaryPreserved true on empty state', roundBoundaryPreserved({}) === true);
ok('roundBoundaryPreserved true on no args', roundBoundaryPreserved() === true);

// Idle teammate WITH an available target → dynamic work → boundary NOT preserved.
const dynReassign = {
  idleTeammates: [{ domain: 'backend' }],
  newlyUnblockedCards: [{ id: 'D-1', domain: 'backend' }],
  discovered: [],
  messages: [],
};
ok('hasDynamicWork true when an idle teammate has a target', hasDynamicWork(dynReassign) === true);
ok('roundBoundaryPreserved false when reassignment is possible', roundBoundaryPreserved(dynReassign) === false);

// An idle teammate but NO takeable target → still a no-op (boundary preserved).
const idleNoTarget = {
  idleTeammates: [{ domain: 'backend' }],
  newlyUnblockedCards: [{ id: 'E-1', domain: 'backend', status: 'completed' }],
  discovered: [],
  messages: [],
};
ok('idle teammate but no takeable target → boundary preserved', roundBoundaryPreserved(idleNoTarget) === true);

// Discovered/injected cards alone → dynamic work.
const dynDiscovered = { idleTeammates: [], newlyUnblockedCards: [], discovered: [{ id: 'C' }], messages: [] };
ok('hasDynamicWork true when discovered cards present', hasDynamicWork(dynDiscovered) === true);
ok('roundBoundaryPreserved false when discovered cards present', roundBoundaryPreserved(dynDiscovered) === false);

// Blocker message alone → dynamic work.
const dynBlocker = { idleTeammates: [], newlyUnblockedCards: [], discovered: [], messages: ['blocked on infra'] };
ok('hasDynamicWork true when a blocker message present', hasDynamicWork(dynBlocker) === true);
ok('roundBoundaryPreserved false when a blocker message present', roundBoundaryPreserved(dynBlocker) === false);

// injectCard output feeds hasDynamicWork (discovered non-empty after injection).
const afterInject = injectCard({ schedulable: [], discovered: [] }, { id: 'NEW' });
ok('round state after injectCard reports dynamic work', hasDynamicWork(afterInject) === true);

/* --- DEFAULTS shape ------------------------------------------------------- */

ok('DEFAULTS exports tieBreak + blockerKeywords', DEFAULTS.tieBreak === 'lowest-id' && Array.isArray(DEFAULTS.blockerKeywords) && DEFAULTS.blockerKeywords.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
