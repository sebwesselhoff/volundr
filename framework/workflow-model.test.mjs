// Self-test for workflow-model.mjs (FRW-BL-075). Run: node framework/workflow-model.test.mjs
import {
  TIER_ORDER,
  SAFE_DEFAULT_TIER,
  MODEL_LABEL_SEP,
  WORKFLOW_ROLE_TIERS,
  resolveWorkflowModel,
  workflowModelOpts,
  describeResolution,
  isDefaultHaikuRisk,
} from './workflow-model.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('workflow-model self-test\n');

// --- exports / constants ---------------------------------------------------------------------
ok('TIER_ORDER is LOW->HIGH haiku,sonnet,opus', JSON.stringify(TIER_ORDER) === JSON.stringify(['haiku', 'sonnet', 'opus']));
ok('TIER_ORDER frozen', Object.isFrozen(TIER_ORDER));
ok('SAFE_DEFAULT_TIER is sonnet (never haiku)', SAFE_DEFAULT_TIER === 'sonnet');
ok('WORKFLOW_ROLE_TIERS frozen', Object.isFrozen(WORKFLOW_ROLE_TIERS));
ok('MODEL_LABEL_SEP is a colon', MODEL_LABEL_SEP === ':');

// --- resolveWorkflowModel: the three named buckets (ISC-1 map) --------------------------------
ok('haiku bucket: locate -> haiku', resolveWorkflowModel('locate') === 'haiku');
ok('haiku bucket: extract -> haiku', resolveWorkflowModel('extract') === 'haiku');
ok('haiku bucket: format -> haiku', resolveWorkflowModel('format') === 'haiku');
ok('sonnet bucket: comprehension-reader -> sonnet', resolveWorkflowModel('comprehension-reader') === 'sonnet');
ok('sonnet bucket: read -> sonnet', resolveWorkflowModel('read') === 'sonnet');
ok('sonnet bucket: implementation -> sonnet', resolveWorkflowModel('implementation') === 'sonnet');
ok('sonnet bucket: implement -> sonnet', resolveWorkflowModel('implement') === 'sonnet');
ok('sonnet bucket: review -> sonnet', resolveWorkflowModel('review') === 'sonnet');
ok('sonnet bucket: verify -> sonnet', resolveWorkflowModel('verify') === 'sonnet');
ok('opus bucket: synthesis -> opus', resolveWorkflowModel('synthesis') === 'opus');
ok('opus bucket: architecture -> opus', resolveWorkflowModel('architecture') === 'opus');
ok('opus bucket: judge -> opus', resolveWorkflowModel('judge') === 'opus');
ok('opus bucket: critic -> opus', resolveWorkflowModel('critic') === 'opus');
ok('opus bucket: high-risk-review -> opus', resolveWorkflowModel('high-risk-review') === 'opus');

// --- CORE FRW-BL-075 GUARANTEE (ISC-2): unknown/forgotten role NEVER falls to haiku -----------
ok('unknown role -> sonnet, NOT haiku', resolveWorkflowModel('frobnicate') === 'sonnet');
ok('empty string role -> sonnet', resolveWorkflowModel('') === 'sonnet');
ok('undefined role -> sonnet', resolveWorkflowModel(undefined) === 'sonnet');
ok('null role -> sonnet', resolveWorkflowModel(null) === 'sonnet');
ok('non-string role -> sonnet', resolveWorkflowModel(42) === 'sonnet');
// ISC-2 spelled out: synthesis/critic/review roles are NEVER haiku by default.
for (const role of ['synthesis', 'synthesize', 'critic', 'critique', 'review', 'judge', 'architecture']) {
  ok(`ISC-2: "${role}" never resolves to haiku`, resolveWorkflowModel(role) !== 'haiku');
}

// --- prototype-pollution / inherited-key hardening (adversarial finding, FRW-BL-075 verify) ---
// A role named after an Object.prototype member must NOT leak an inherited function/object; it
// resolves to the safe default like any other unknown role.
for (const bad of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'prototype']) {
  ok(`inherited/proto key "${bad}" -> sonnet (no leaked function/object)`, resolveWorkflowModel(bad) === 'sonnet');
}
ok('opts(constructor).model === sonnet (no proto leak into opts)', workflowModelOpts('constructor').model === 'sonnet');
ok('isDefaultHaikuRisk(constructor) true (resolves sonnet, not a leaked value)', isDefaultHaikuRisk('constructor') === true);

// --- normalisation: case-insensitive + trimmed -----------------------------------------------
ok('case-insensitive: "Synthesis" -> opus', resolveWorkflowModel('Synthesis') === 'opus');
ok('trims whitespace: "  REVIEW  " -> sonnet', resolveWorkflowModel('  REVIEW  ') === 'sonnet');

// --- strictSchema floor (ISC-4): haiku-tier roles bump to sonnet when a strict schema is used --
ok('strictSchema floors extract haiku -> sonnet', resolveWorkflowModel('extract', { strictSchema: true }) === 'sonnet');
ok('strictSchema floors locate haiku -> sonnet', resolveWorkflowModel('locate', { strictSchema: true }) === 'sonnet');
ok('strictSchema leaves sonnet role at sonnet', resolveWorkflowModel('review', { strictSchema: true }) === 'sonnet');
ok('strictSchema does NOT downgrade opus role', resolveWorkflowModel('synthesis', { strictSchema: true }) === 'opus');
ok('strictSchema floors UNKNOWN role (already sonnet)', resolveWorkflowModel('mystery', { strictSchema: true }) === 'sonnet');

// --- workflowModelOpts: resolved model + observable label (ISC-3) -----------------------------
const synOpts = workflowModelOpts('synthesis');
ok('opts(synthesis).model === opus', synOpts.model === 'opus');
ok('opts(synthesis).label === "synthesis:opus"', synOpts.label === 'synthesis:opus');
const secOpts = workflowModelOpts('review', { label: 'sec' });
ok('custom label preserved + model appended -> "sec:sonnet"', secOpts.label === 'sec:sonnet' && secOpts.model === 'sonnet');
const exOpts = workflowModelOpts('extract', { strictSchema: true });
ok('opts(extract, strictSchema) -> sonnet + "extract:sonnet"', exOpts.model === 'sonnet' && exOpts.label === 'extract:sonnet');
const passOpts = workflowModelOpts('read', { effort: 'high', agentType: 'Explore', schema: { type: 'object' } });
ok('passthrough preserves effort', passOpts.effort === 'high');
ok('passthrough preserves agentType', passOpts.agentType === 'Explore');
ok('passthrough preserves schema', passOpts.schema && passOpts.schema.type === 'object');
ok('internal strictSchema key never leaks into opts', !('strictSchema' in passOpts));
ok('internal label input key replaced by computed label', typeof passOpts.label === 'string' && passOpts.label.endsWith(':sonnet'));
const unkOpts = workflowModelOpts('frobnicate');
ok('unknown role opts -> sonnet + "frobnicate:sonnet"', unkOpts.model === 'sonnet' && unkOpts.label === 'frobnicate:sonnet');
const emptyOpts = workflowModelOpts('');
ok('empty role opts -> "agent:sonnet" fallback base', emptyOpts.label === 'agent:sonnet');
// ISC-3: EVERY resolved opts label carries the model name, so a silent default is visible.
for (const role of ['locate', 'review', 'synthesis', 'frobnicate']) {
  const o = workflowModelOpts(role);
  ok(`ISC-3: opts("${role}").label contains its model "${o.model}"`, o.label.includes(o.model));
}

// --- describeResolution: log()-friendly line ------------------------------------------------
ok('describeResolution(synthesis) names role + opus', describeResolution('synthesis') === 'workflow model: synthesis -> opus');
ok('describeResolution(unspecified) is graceful', describeResolution() === 'workflow model: (unspecified) -> sonnet');

// --- isDefaultHaikuRisk: detect roles that MUST pass an explicit model ------------------------
ok('isDefaultHaikuRisk(synthesis) true', isDefaultHaikuRisk('synthesis') === true);
ok('isDefaultHaikuRisk(review) true', isDefaultHaikuRisk('review') === true);
ok('isDefaultHaikuRisk(locate) false', isDefaultHaikuRisk('locate') === false);
ok('isDefaultHaikuRisk(extract) false', isDefaultHaikuRisk('extract') === false);
ok('isDefaultHaikuRisk(unknown) true (defaults to sonnet)', isDefaultHaikuRisk('frobnicate') === true);
ok('isDefaultHaikuRisk(extract, strictSchema) true (floored to sonnet)', isDefaultHaikuRisk('extract', { strictSchema: true }) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
