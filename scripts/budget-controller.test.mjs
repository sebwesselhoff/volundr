// Self-test for budget-controller.mjs (FRW-BL-053). Run: node scripts/budget-controller.test.mjs
import {
  TIER_ORDER,
  DEFAULTS,
  createBudgetTracker,
  selectTier,
  classifyError,
  nextFallback,
  createTokenLedger,
  checkBudgetGate,
} from './budget-controller.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('budget-controller self-test\n');

// --- TIER_ORDER / DEFAULTS ---
ok('TIER_ORDER is downgrade order opus->sonnet->haiku', JSON.stringify(TIER_ORDER) === JSON.stringify(['opus', 'sonnet', 'haiku']));
ok('TIER_ORDER frozen', Object.isFrozen(TIER_ORDER));
ok('DEFAULTS exports budgets + thresholds', DEFAULTS.perCardTokens > 0 && DEFAULTS.perTeammateTokens > 0 && DEFAULTS.thresholds.oneStepDown === 0.5 && DEFAULTS.thresholds.toFloor === 0.2);

// --- createBudgetTracker: ISC #1 (accumulate + withinBudget flips at the limit BOUNDARY) ---
{
  const t = createBudgetTracker({ perCardTokens: 1000, perTeammateTokens: 5000 });
  t.record('card-A', 300);
  t.record('card-A', 200);
  ok('tracker accumulates per scope', t.spent('card-A') === 500);
  ok('separate scopes are independent', t.spent('card-B') === 0);
  ok('remaining = limit - spent', t.remaining('card-A', 1000) === 500);
  ok('within budget below limit', t.withinBudget('card-A', 1000) === true);

  // Push exactly to the limit -> NOT within budget (limit is the cap; reaching it is over).
  t.record('card-A', 500); // total now 1000 == limit
  ok('spend equal to limit -> NOT within budget (boundary flip)', t.withinBudget('card-A', 1000) === false);
  ok('remaining clamps at 0 (not negative) when over', t.remaining('card-A', 1000) === 0);

  // One token below the limit is still within.
  const t2 = createBudgetTracker();
  t2.record('s', 999);
  ok('one token below limit is within budget', t2.withinBudget('s', 1000) === true);

  // Per-teammate budget enforced via same primitive, different scope id + limit.
  const tm = createBudgetTracker({ perTeammateTokens: 2000 });
  tm.record('dev-1', 1500);
  ok('per-teammate scope within budget', tm.withinBudget('dev-1', tm.perTeammateTokens) === true);
  tm.record('dev-1', 600); // 2100 > 2000
  ok('per-teammate scope over budget flips', tm.withinBudget('dev-1', tm.perTeammateTokens) === false);

  // Defensive: negative / NaN tokens treated as 0.
  const t3 = createBudgetTracker();
  t3.record('z', -50);
  t3.record('z', NaN);
  ok('negative/NaN tokens ignored (no accumulation)', t3.spent('z') === 0);
}

// --- selectTier: ISC #2 (downgrade at fractions, never upgrade, clamp) ---
ok('full budget -> base tier (opus stays opus)', selectTier({ baseTier: 'opus', fractionRemaining: 1 }) === 'opus');
ok('0.5 exactly -> no downgrade (strictly < 0.5)', selectTier({ baseTier: 'opus', fractionRemaining: 0.5 }) === 'opus');
ok('< 0.5 -> one step down (opus->sonnet)', selectTier({ baseTier: 'opus', fractionRemaining: 0.4 }) === 'sonnet');
ok('0.2 exactly -> still one step down (strictly < 0.2 for floor)', selectTier({ baseTier: 'opus', fractionRemaining: 0.2 }) === 'sonnet');
ok('< 0.2 -> floor haiku from opus', selectTier({ baseTier: 'opus', fractionRemaining: 0.1 }) === 'haiku');
ok('sonnet one-step-down -> haiku', selectTier({ baseTier: 'sonnet', fractionRemaining: 0.4 }) === 'haiku');
ok('sonnet deeply depleted -> haiku (clamp)', selectTier({ baseTier: 'sonnet', fractionRemaining: 0.05 }) === 'haiku');
ok('haiku never upgrades regardless of budget', selectTier({ baseTier: 'haiku', fractionRemaining: 1 }) === 'haiku');
ok('haiku stays haiku when depleted (clamp at floor)', selectTier({ baseTier: 'haiku', fractionRemaining: 0.01 }) === 'haiku');
ok('default baseTier is sonnet', selectTier({ fractionRemaining: 1 }) === 'sonnet');
ok('unknown baseTier -> floor', selectTier({ baseTier: 'gpt', fractionRemaining: 1 }) === 'haiku');
ok('custom thresholds respected', selectTier({ baseTier: 'opus', fractionRemaining: 0.7, thresholds: { oneStepDown: 0.8, toFloor: 0.3 } }) === 'sonnet');

// --- classifyError: ISC #3 (maps each class) ---
ok('529 numeric status -> overloaded_529', classifyError({ status: 529 }) === 'overloaded_529');
ok('"Overloaded" text -> overloaded_529', classifyError('Error: Overloaded') === 'overloaded_529');
ok('"529" in text -> overloaded_529', classifyError('HTTP 529 from upstream') === 'overloaded_529');
ok('429 status -> rate_limit', classifyError({ statusCode: 429 }) === 'rate_limit');
ok('"rate limit" text -> rate_limit', classifyError('rate limit exceeded') === 'rate_limit');
ok('"too many requests" -> rate_limit', classifyError('429 Too Many Requests') === 'rate_limit');
ok('ETIMEDOUT -> transient', classifyError(new Error('connect ETIMEDOUT 1.2.3.4:443')) === 'transient');
ok('ECONNRESET -> transient', classifyError('read ECONNRESET') === 'transient');
ok('"timeout" text -> transient', classifyError('request timeout after 30s') === 'transient');
ok('auth/validation -> fatal', classifyError('401 Unauthorized: invalid api key') === 'fatal');
ok('unknown text -> fatal', classifyError('totally unexpected') === 'fatal');
ok('null -> fatal', classifyError(null) === 'fatal');
ok('overloaded precedence over 429 when both present', classifyError('429 overloaded') === 'overloaded_529');

// --- nextFallback: ISC #3 (step down on retryable, escalate at haiku / fatal) ---
{
  const f1 = nextFallback('opus', 'overloaded_529');
  ok('529 on opus -> fall back to sonnet, retry', f1.tier === 'sonnet' && f1.retry === true && f1.escalate === false);
  const f2 = nextFallback('sonnet', 'rate_limit');
  ok('rate_limit on sonnet -> fall back to haiku, retry', f2.tier === 'haiku' && f2.retry === true && f2.escalate === false);
  const f3 = nextFallback('sonnet', 'transient');
  ok('transient on sonnet -> fall back to haiku, retry', f3.tier === 'haiku' && f3.retry === true);
  const f4 = nextFallback('haiku', 'overloaded_529');
  ok('retryable at haiku -> escalate (chain exhausted)', f4.escalate === true && f4.retry === false);
  const f5 = nextFallback('opus', 'fatal');
  ok('fatal -> no fallback tier, escalate, no retry', f5.tier === null && f5.escalate === true && f5.retry === false);
  const f6 = nextFallback('mystery', 'transient');
  ok('unknown current tier on retryable -> drop to floor, retry', f6.tier === 'haiku' && f6.retry === true);
}

// --- createTokenLedger: ISC #4 (record exactly once per card) ---
{
  const led = createTokenLedger();
  const r1 = led.record('CARD-1', 1200);
  ok('first record -> recorded:true, duplicate:false', r1.recorded === true && r1.duplicate === false && r1.value === 1200);
  ok('ledger.get returns stored usage', led.get('CARD-1') === 1200);
  ok('ledger.total reflects first record', led.total() === 1200);

  const r2 = led.record('CARD-1', 9999); // same cardId, different number
  ok('second record same cardId -> duplicate:true, not recorded', r2.duplicate === true && r2.recorded === false);
  ok('duplicate did NOT change stored value', led.get('CARD-1') === 1200);
  ok('duplicate did NOT change total (recorded exactly once)', led.total() === 1200);

  led.record('CARD-2', 800);
  ok('distinct card adds to total', led.total() === 2000);
  ok('has() tracks recorded cards', led.has('CARD-1') === true && led.has('CARD-X') === false);
  ok('entries() snapshots both cards', led.entries().length === 2);

  // Negative/NaN usage coerces to 0 but still occupies the slot (recorded once).
  const led2 = createTokenLedger();
  const rn = led2.record('C', -5);
  ok('negative usage coerced to 0 but still recorded once', rn.recorded === true && rn.value === 0 && led2.total() === 0);
  ok('re-record after a 0-usage card is still a duplicate', led2.record('C', 100).duplicate === true && led2.total() === 0);
}

// --- checkBudgetGate: FRW-BL-063 ISC-3 cost_gate_pause emit site --------------------------------
{
  // Recording dispatcher stands in for notify-event.notifyEvent.
  const makeNotify = () => { const calls = []; const fn = async (e, p, o) => { calls.push({ e, p, o }); return { fired: true }; }; fn.calls = calls; return fn; };

  // Under budget → no pause, no notification.
  {
    const notify = makeNotify();
    const r = await checkBudgetGate({ scopeId: 'card-1', spentTokens: 100, limitTokens: 1000, notify });
    ok('checkBudgetGate: under budget → not paused, not notified', r.paused === false && r.notified === false && notify.calls.length === 0);
  }
  // At/over token budget → PAUSE + fire cost_gate_pause.
  {
    const notify = makeNotify();
    const r = await checkBudgetGate({ scopeId: 'card-1', spentTokens: 1000, limitTokens: 1000, notify, notifyOpts: { channels: ['terminal-bell'] } });
    ok('checkBudgetGate: spent==limit → paused', r.paused === true && /token budget reached/.test(r.reason));
    ok('each-event-fires (cost_gate_pause): notify called with event+payload', notify.calls.length === 1 && notify.calls[0].e === 'cost_gate_pause' && notify.calls[0].p.scopeId === 'card-1');
    ok('checkBudgetGate: notified true when dispatcher fires', r.notified === true);
  }
  // USD ceiling tripped → pause + fire.
  {
    const notify = makeNotify();
    const r = await checkBudgetGate({ scopeId: 'card-2', spentTokens: 0, limitTokens: 1e9, spentUsd: 12, ceilingUsd: 10, notify, notifyOpts: { channels: ['terminal-bell'] } });
    ok('checkBudgetGate: USD ceiling reached → paused + cost_gate_pause fired', r.paused === true && /USD cost ceiling/.test(r.reason) && notify.calls.length === 1 && notify.calls[0].e === 'cost_gate_pause');
  }
  // Off-by-default real path: no notify injected, no config → never throws, no side effect (uses
  // real notifyEvent which is OFF). The pure pause decision still holds.
  {
    const r = await checkBudgetGate({ scopeId: 'c', spentTokens: 5, limitTokens: 5, notifyOpts: { env: {} } });
    ok('checkBudgetGate: off-by-default real path → paused decision holds, no throw', r.paused === true);
  }
  // A throwing dispatcher must never break the gate.
  {
    const r = await checkBudgetGate({ scopeId: 'c', spentTokens: 5, limitTokens: 5, notify: async () => { throw new Error('boom'); } });
    ok('checkBudgetGate: throwing dispatcher swallowed (pause still returned)', r.paused === true && r.notified === false);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
