#!/usr/bin/env node
/**
 * skill-resolver.mjs — declarative skill-contract resolver (FRW-BL-062)
 *
 * Consumes the machine-readable `contracts` block defined in a pack manifest
 * (see framework/packs/core/pack.json) and described in
 * framework/packs/PACK-PROMPT-SKELETON.md. It lets the orchestrator:
 *   1. Load the per-agentType contract map from a pack manifest.
 *   2. Resolve a contract's typed inputs against caller-provided values
 *      (filling fixed defaults, flagging unmet required inputs).
 *   3. Resolve declared sub-skill dependencies transitively over
 *      `requiredSkills`, in a stable order, without looping on cycles.
 *
 * Pure Node ESM. JSDoc types only. NO external dependencies.
 * This module reads declarative data only — it does NOT touch retry/round logic.
 *
 * @typedef {Object} InputSpec
 * @property {string} [type]      Declared type of the input (e.g. "string").
 * @property {boolean} [required] Whether the input must be provided by the caller.
 * @property {*} [default]        Fixed default used when the input is absent.
 *
 * @typedef {Object} SkillContract
 * @property {string[]} [requiredSkills] Sub-skills that MUST resolve (transitive).
 * @property {string[]} [optionalSkills] Sub-skills offered but not required.
 * @property {Object.<string, InputSpec>} [inputs] Typed input specifications.
 *
 * @typedef {Object.<string, SkillContract>} ContractsByType
 *   Map keyed by agentType (e.g. "developer", "architect", "reviewer").
 */

/**
 * Extract the `contracts` map from a pack manifest object.
 *
 * @param {Object} packManifest Parsed pack.json object (or anything).
 * @returns {ContractsByType} The contracts map, or `{}` if absent/invalid.
 */
export function loadContracts(packManifest) {
  if (
    packManifest &&
    typeof packManifest === 'object' &&
    packManifest.contracts &&
    typeof packManifest.contracts === 'object'
  ) {
    return /** @type {ContractsByType} */ (packManifest.contracts);
  }
  return {};
}

/**
 * Resolve a contract's typed inputs against caller-provided values.
 *
 * For each declared input: if the caller provided a value it is kept; else the
 * fixed `default` is applied when one exists; required inputs left without a
 * value are reported in `missingRequired`. Provided values for inputs that the
 * contract does not declare are passed through unchanged (forward-compatible).
 *
 * @param {SkillContract} contract The contract whose `inputs` to resolve.
 * @param {Object.<string, *>} [providedInputs] Caller-supplied input values.
 * @returns {{ resolved: Object.<string, *>, missingRequired: string[] }}
 */
export function resolveInputs(contract, providedInputs) {
  const inputs = (contract && contract.inputs) || {};
  const provided = providedInputs || {};
  /** @type {Object.<string, *>} */
  const resolved = {};
  /** @type {string[]} */
  const missingRequired = [];

  for (const [name, spec] of Object.entries(inputs)) {
    const hasProvided = Object.prototype.hasOwnProperty.call(provided, name) &&
      provided[name] !== undefined;
    if (hasProvided) {
      resolved[name] = provided[name];
      continue;
    }
    if (spec && Object.prototype.hasOwnProperty.call(spec, 'default')) {
      resolved[name] = spec.default;
      continue;
    }
    if (spec && spec.required) {
      missingRequired.push(name);
    }
  }

  // Pass through extra provided values not declared by the contract.
  for (const [name, value] of Object.entries(provided)) {
    if (!Object.prototype.hasOwnProperty.call(inputs, name) && value !== undefined) {
      resolved[name] = value;
    }
  }

  return { resolved, missingRequired };
}

/**
 * Resolve declared sub-skill dependencies for an agentType, transitively over
 * `requiredSkills`. Traversal is depth-first with deterministic ordering: a
 * dependency appears before the contract that requires it (post-order), and
 * siblings keep their declared order. Missing referenced contracts are treated
 * as leaf skills (still included). Cycle-safe: on detecting a back-edge the
 * traversal stops and the offending path is returned in `cycle`.
 *
 * @param {string} agentType The root agentType key (e.g. "developer").
 * @param {ContractsByType} contractsByType The full contracts map.
 * @returns {{ skills: string[], cycle: (string[]|null) }}
 *   `skills`: transitive required sub-skills in stable order (root excluded).
 *   `cycle`: the path of the first cycle found (e.g. ["a","b","a"]), else null.
 */
export function resolveSubSkillDeps(agentType, contractsByType) {
  const contracts = contractsByType || {};
  /** @type {string[]} */
  const order = [];
  const done = new Set();
  /** @type {string[]|null} */
  let cycle = null;

  /**
   * @param {string} name Current node name.
   * @param {string[]} stack Active recursion stack (path from root).
   */
  const visit = (name, stack) => {
    if (cycle) return;
    if (stack.includes(name)) {
      cycle = [...stack.slice(stack.indexOf(name)), name];
      return;
    }
    if (done.has(name)) return;
    const contract = contracts[name];
    const required = (contract && Array.isArray(contract.requiredSkills))
      ? contract.requiredSkills
      : [];
    const nextStack = [...stack, name];
    for (const dep of required) {
      visit(dep, nextStack);
      if (cycle) return;
    }
    done.add(name);
    // Exclude the root agentType from the emitted skill list.
    if (stack.length > 0) order.push(name);
  };

  visit(agentType, []);
  if (cycle) return { skills: [], cycle };
  return { skills: order, cycle: null };
}

const isMain = process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  // Tiny CLI demo: print resolved skills for an agentType from a pack.json path.
  // Usage: node skill-resolver.mjs <pack.json> <agentType>
  const [, , manifestPath, agentType] = process.argv;
  if (manifestPath && agentType) {
    const { readFileSync } = await import('fs');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const contracts = loadContracts(manifest);
    console.log(JSON.stringify(resolveSubSkillDeps(agentType, contracts), null, 2));
  }
}
