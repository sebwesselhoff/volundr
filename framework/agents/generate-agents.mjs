#!/usr/bin/env node
/**
 * generate-agents.mjs — emit native Claude Code agent definitions (FRW-BL-037)
 *
 * SINGLE SOURCE OF TRUTH: reads `registry.data.mjs` (+ each agent's pack
 * `.mcp.json`) and emits `.claude/agents/<name>.md` — the native Claude Code
 * agent-definition files (frontmatter: name, description, model, tools,
 * disallowedTools, permissionMode, maxTurns, memory, isolation, mcpServers, …;
 * body = a pointer to the registry's `promptTemplate`). The hand-maintained defs
 * had DRIFTED (their bodies pointed at the non-existent `framework/agents/prompts/…`
 * path); generating them from the registry guarantees they never drift again.
 *
 * Pure Node ESM. NO external dependencies, NO tsc/ts-node (the worktree has no
 * node_modules). Deterministic + IDEMPOTENT: running it twice yields byte-identical
 * files. `git`-friendly output (stable key order, LF line endings, trailing newline).
 *
 * CLI:
 *   node framework/agents/generate-agents.mjs           # write the defs
 *   node framework/agents/generate-agents.mjs --check    # exit 1 if regenerating
 *                                                        # would change any file (CI drift gate)
 */

import { AGENT_REGISTRY_DATA } from './registry.data.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// repoRoot = .../framework/agents -> up two levels
const REPO_ROOT = resolve(__dirname, '..', '..');
const AGENTS_OUT_DIR = join(REPO_ROOT, '.claude', 'agents');

/**
 * Which registry agent types get a native `.claude/agents/*.md` definition, and
 * the output filename for each. We match the historical 9-file set exactly.
 *
 * Inclusion rule (documented in NATIVE-AGENTS.md): emit a def for the spawnable,
 * persistent agent roles. EXCLUDE:
 *   - `volundr`          — the team LEAD itself, not a spawnable teammate def.
 *   - `planner`          — Agent-tool subagent that returns JSON (no native def historically).
 *   - `roundtable-voice`,
 *     `chaos-engine-voice` — TEMPORARY roundtable-only voices.
 *   - `developer-subagent` — flat-mode Agent-tool variant of `developer` (same template family).
 *   - `tester`, `content` — Agent-tool subagents (file-only), dispatched via prompt template.
 *   - `debugger`, `performance-engineer`, `security-auditor` — FRW-BL-056 roles not
 *     yet promoted to native defs (kept template-dispatched for now).
 *
 * The registry key `review` maps to the file `reviewer.md` (its customizationKey).
 * To add an agent to the native set later: add an entry here — that is the ONLY
 * place the spawnable set is declared.
 */
const NATIVE_AGENTS = [
  { type: 'architect',       file: 'architect.md' },
  { type: 'designer',        file: 'designer.md' },
  { type: 'developer',       file: 'developer.md' },
  { type: 'devops-engineer', file: 'devops-engineer.md' },
  { type: 'fixer',           file: 'fixer.md' },
  { type: 'guardian',        file: 'guardian.md' },
  { type: 'qa-engineer',     file: 'qa-engineer.md' },
  { type: 'researcher',      file: 'researcher.md' },
  { type: 'review',          file: 'reviewer.md' },
];

/** The mutating / spawning tools whose ABSENCE we surface as `disallowedTools`. */
const RESTRICTABLE_TOOLS = ['Agent', 'Bash', 'Write', 'Edit', 'NotebookEdit'];

/** Map a registry model id to the short Claude Code model alias. */
function shortModel(model) {
  if (model.startsWith('opus')) return 'opus';
  if (model.startsWith('sonnet')) return 'sonnet';
  if (model.startsWith('haiku')) return 'haiku';
  return model;
}

/**
 * Team-coordination tools added to a teammate's `tools` list.
 * Read-only roles (permissionMode 'plan') get the read-only task tools only.
 * Guardian historically carries no task tools beyond SendMessage; we give it the
 * read-only task tools for parity with the other read-only teammates.
 */
function teamTools(def) {
  if (!def.teammate) return []; // Agent-tool subagents (e.g. fixer) get no team tools.
  const readOnly = def.permissionMode === 'plan';
  return readOnly
    ? ['SendMessage', 'TaskList', 'TaskGet']
    : ['SendMessage', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
}

/** Final ordered tool list for an agent def (registry tools first, then team tools). */
function resolveTools(def) {
  const out = [];
  const seen = new Set();
  for (const t of [...def.tools, ...teamTools(def)]) {
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** disallowedTools = restrictable tools the agent does NOT have, in canonical order. */
function resolveDisallowedTools(allowed) {
  const allowedSet = new Set(allowed);
  return RESTRICTABLE_TOOLS.filter((t) => !allowedSet.has(t));
}

/** Load a pack's `.mcp.json` mcpServers object, or null if the pack has none. */
function loadPackMcpServers(pack) {
  if (!pack) return null;
  const p = join(REPO_ROOT, 'framework', 'packs', pack, '.mcp.json');
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    const servers = parsed && parsed.mcpServers;
    if (servers && typeof servers === 'object' && Object.keys(servers).length > 0) {
      return servers;
    }
  } catch {
    return null;
  }
  return null;
}

// --- Deterministic YAML emission ------------------------------------------

function yamlScalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // Quote only when the value could be misread by a YAML parser. A leading
  // indicator char, leading/trailing space, an embedded `: ` or ` #`, or a YAML
  // keyword needs quoting; a mid-token hyphen/slash/period is safe bare (e.g.
  // `devops-engineer`, `framework/...`). Double-quoted JSON form is deterministic.
  const needsQuote =
    s === '' ||
    /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||  // leading indicator/space
    /\s$/.test(s) ||                            // trailing space
    /:\s/.test(s) || /:$/.test(s) ||            // mapping-like `key: ` or `key:`
    /\s#/.test(s) ||                            // inline comment
    /[\[\]{},]/.test(s) ||                       // flow collection chars
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[0-9.+-]+$/.test(s);                       // numeric-looking
  return needsQuote ? JSON.stringify(s) : s;
}

/** Emit a string[] as a YAML block sequence under `key:` (1-space indent per existing defs). */
function yamlList(key, arr) {
  const lines = [`${key}:`];
  for (const item of arr) lines.push(` - ${yamlScalar(item)}`);
  return lines.join('\n');
}

/**
 * Emit a nested object (the mcpServers map) as deterministic block YAML.
 * Key order is preserved from the source `.mcp.json` (stable per file).
 */
function yamlObject(obj, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      for (const item of v) lines.push(`${pad}  - ${yamlScalar(item)}`);
    } else if (v && typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(yamlObject(v, indent + 2));
    } else {
      lines.push(`${pad}${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build the full `.md` content for one agent (frontmatter + body).
 * `name` is the native agent name used for `claude --agent <name>` dispatch — it
 * equals the output basename (== the registry `customizationKey`), which is why
 * the registry key `review` becomes the dispatchable name `reviewer`.
 */
function renderAgent(type, def, name = type) {
  const tools = resolveTools(def);
  const disallowed = resolveDisallowedTools(tools);
  const mcpServers = loadPackMcpServers(def.pack);

  const fm = [];
  fm.push(`name: ${yamlScalar(name)}`);
  fm.push(`description: ${yamlScalar(def.description)}`);
  fm.push(`model: ${yamlScalar(shortModel(def.model))}`);
  fm.push(yamlList('tools', tools));
  if (disallowed.length > 0) fm.push(yamlList('disallowedTools', disallowed));
  if (def.permissionMode) fm.push(`permissionMode: ${yamlScalar(def.permissionMode)}`);
  if (typeof def.maxTurns === 'number') fm.push(`maxTurns: ${def.maxTurns}`);
  if (def.effort) fm.push(`effort: ${yamlScalar(def.effort)}`);
  if (def.memory) fm.push(`memory: ${yamlScalar(def.memory)}`);
  if (def.isolation) fm.push(`isolation: ${yamlScalar(def.isolation)}`);
  if (Array.isArray(def.skills) && def.skills.length > 0) fm.push(yamlList('skills', def.skills));
  if (def.initialPrompt) fm.push(`initialPrompt: ${yamlScalar(def.initialPrompt)}`);
  if (mcpServers) {
    fm.push('mcpServers:');
    fm.push(yamlObject(mcpServers, 2));
  }

  // Body: a pointer to the registry's promptTemplate (the CORRECT path — fixes the
  // stale `framework/agents/prompts/…` pointers). Includes the whenToUse cue + the
  // GENERATED banner so no one hand-edits these files.
  const body = [];
  body.push(`<!-- GENERATED by framework/agents/generate-agents.mjs from framework/agents/registry.data.mjs — DO NOT EDIT. Run \`node framework/agents/generate-agents.mjs\` to regenerate. -->`);
  body.push('');
  const role = humanRole(type);
  body.push(`You are the ${role}. See \`${def.promptTemplate}\` for your full protocol.`);
  if (def.whenToUse) {
    body.push('');
    body.push(`**When to use:** ${def.whenToUse}`);
  }

  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

/** A readable role label for the body sentence, derived from the type. */
function humanRole(type) {
  const labels = {
    architect: 'Architect teammate',
    designer: 'Designer teammate',
    developer: 'Developer teammate',
    'devops-engineer': 'DevOps Engineer teammate',
    fixer: 'Fixer agent',
    guardian: 'Guardian teammate',
    'qa-engineer': 'QA Engineer teammate',
    researcher: 'Researcher teammate',
    review: 'Reviewer teammate',
  };
  return labels[type] || `${type} agent`;
}

/** Compute the { file -> content } map for the full native set. */
function buildAll() {
  const out = new Map();
  for (const { type, file } of NATIVE_AGENTS) {
    const def = AGENT_REGISTRY_DATA[type];
    if (!def) throw new Error(`registry.data.mjs has no agent type "${type}" (declared in NATIVE_AGENTS)`);
    const name = file.replace(/\.md$/, '');  // dispatch name == file basename (== customizationKey)
    out.set(file, renderAgent(type, def, name));
  }
  return out;
}

// --- CLI ------------------------------------------------------------------

/** Normalize line endings so the drift comparison is EOL-agnostic. This repo
 *  has core.autocrlf=true, so a fresh checkout may give the working tree CRLF
 *  even though the generator emits LF — comparing on normalized LF avoids a
 *  false-positive drift in `--check` (CI) and a no-op rewrite churn. */
function normalizeEol(s) {
  return s == null ? s : s.replace(/\r\n/g, '\n');
}

function main() {
  const check = process.argv.includes('--check');
  const all = buildAll();
  let changed = 0;
  const changedFiles = [];

  for (const [file, content] of all) {
    const path = join(AGENTS_OUT_DIR, file);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    // Compare content-only (EOL-agnostic); the generator always emits LF.
    if (normalizeEol(existing) === normalizeEol(content)) continue;
    changed++;
    changedFiles.push(file);
    if (!check) writeFileSync(path, content, 'utf8');
  }

  if (check) {
    if (changed > 0) {
      console.error(`drift: ${changed} agent def(s) would change: ${changedFiles.join(', ')}`);
      console.error('Run: node framework/agents/generate-agents.mjs');
      process.exit(1);
    }
    console.log(`ok: all ${all.size} agent defs up to date`);
    process.exit(0);
  }

  if (changed > 0) {
    console.log(`wrote ${changed} agent def(s): ${changedFiles.join(', ')}`);
  } else {
    console.log(`ok: all ${all.size} agent defs already up to date`);
  }
  process.exit(0);
}

// Exported for the test harness.
export { buildAll, renderAgent, resolveTools, resolveDisallowedTools, shortModel, NATIVE_AGENTS, loadPackMcpServers };

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '')) {
  main();
}
