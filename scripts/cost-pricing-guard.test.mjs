// Cost-pricing invariant guard (FRW-BL-060). Run: node scripts/cost-pricing-guard.test.mjs
//
// FRW-BL-060 verified that Volundr's cost tracking already prices the FOUR token classes
// (input / cache-creation / cache-read / output) SEPARATELY, per Anthropic pricing — in
// dashboard/packages/shared/src/constants.ts (estimateCost) and end-to-end through the agents
// route (estimateCost(model, prompt, completion, cacheCreation, cacheRead)) and metrics aggregation.
//
// This guard locks that invariant in so a future edit cannot silently COLLAPSE the classes
// (e.g. drop a term or reuse one rate for multiple classes). It is a structural assertion over the
// source — pure Node, no build/deps — so it runs anywhere (worktrees included).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const constantsPath = join(here, '..', 'dashboard', 'packages', 'shared', 'src', 'constants.ts');

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

const src = readFileSync(constantsPath, 'utf8');

console.log('cost-pricing invariant guard (FRW-BL-060)\n');

// 1. MODEL_PRICING declares all four rate classes.
const RATE_KEYS = ['input', 'cacheCreation', 'cacheRead', 'output'];
const pricingTypeMatch = src.match(/MODEL_PRICING\s*:\s*Record<\s*string\s*,\s*\{([^}]*)\}\s*>/);
ok('MODEL_PRICING type exists', !!pricingTypeMatch);
if (pricingTypeMatch) {
  for (const k of RATE_KEYS) ok(`MODEL_PRICING type declares "${k}"`, new RegExp(`\\b${k}\\b\\s*:`).test(pricingTypeMatch[1]));
}

// 2. Each model row has all four numeric rates, with Anthropic-shaped relationships
//    (cacheRead < input < cacheCreation, output > input). Parses `'model': { input: N, ... }`.
const rowRe = /['"]([\w.-]+)['"]\s*:\s*\{\s*input:\s*([\d.]+)\s*,\s*cacheCreation:\s*([\d.]+)\s*,\s*cacheRead:\s*([\d.]+)\s*,\s*output:\s*([\d.]+)\s*\}/g;
const rows = [...src.matchAll(rowRe)];
ok('at least 3 model pricing rows parsed', rows.length >= 3);
for (const [, model, inp, cc, cr, out] of rows) {
  const i = +inp, c = +cc, r = +cr, o = +out;
  ok(`${model}: four distinct rate fields present`, [i, c, r, o].every(Number.isFinite));
  ok(`${model}: cacheRead (${r}) < input (${i})  [cache-read discount]`, r < i);
  ok(`${model}: cacheCreation (${c}) > input (${i})  [cache-write premium]`, c > i);
  ok(`${model}: output (${o}) > input (${i})  [output premium]`, o > i);
  // Not collapsed: the four rates are not all equal.
  ok(`${model}: rates are not collapsed to one value`, new Set([i, c, r, o]).size === 4);
}

// 3. estimateCost sums FOUR distinct terms, each multiplying its own token class by its own rate.
const fnMatch = src.match(/export function estimateCost\([\s\S]*?\n\}/);
ok('estimateCost function found', !!fnMatch);
if (fnMatch) {
  const body = fnMatch[0];
  ok('prices input separately (pricing.input)', /pricing\.input/.test(body));
  ok('prices cache-creation separately (pricing.cacheCreation)', /pricing\.cacheCreation/.test(body));
  ok('prices cache-read separately (pricing.cacheRead)', /pricing\.cacheRead/.test(body));
  ok('prices output separately (pricing.output)', /pricing\.output/.test(body));
  ok('uses all four token-count params', /inputTokens/.test(body) && /outputTokens/.test(body) && /cacheCreationTokens/.test(body) && /cacheReadTokens/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
