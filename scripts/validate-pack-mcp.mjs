#!/usr/bin/env node
/**
 * validate-pack-mcp.mjs — Pack MCP governance validator (FRW-BL-035)
 *
 * Validates every framework/packs/<pack>/.mcp.json template against the managed
 * baseline documented in framework/packs/MCP-GOVERNANCE.md:
 *   (a) valid JSON with an `mcpServers` object;
 *   (b) NO hard-coded secret-looking literals (secrets must use ${ENV_VAR});
 *   (c) ${CLAUDE_PROJECT_DIR} / ${ENV_VAR} placeholders are well-formed;
 *   (d) self-contained for --strict-mcp-config (no external $ref/include/extends/import);
 *   (e) reports which servers are alwaysLoad.
 *
 * Pure exported fns below are unit-tested by validate-pack-mcp.test.mjs.
 *
 * USAGE: node scripts/validate-pack-mcp.mjs [--repo <path>]
 * EXIT: 1 if any ERROR, else 0. Prints alwaysLoad servers per file.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Top-level keys other than mcpServers that are allowed (documentation-only).
export const ALLOWED_TOP_KEYS = new Set(['mcpServers', '$schema']);

// Keys that would make a config NON-self-contained (break --strict-mcp-config isolation).
export const EXTERNAL_REF_KEYS = ['$ref', 'extends', 'include', 'includes', 'import', 'imports', 'mcpConfig'];

// Server-entry keys whose values are expected to be secrets/credentials if literal.
const SECRET_KEY_RE = /(token|secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|connection[_-]?string|conn[_-]?str|credential|cred|private[_-]?key|sas|bearer|auth)/i;

/** Pure: is `s` a single, fully-templated placeholder value (e.g. "${FOO}")? */
export function isFullPlaceholder(s) {
  return typeof s === 'string' && /^\$\{[A-Z0-9_]+\}$/.test(s.trim());
}

/**
 * Pure: find malformed ${...} placeholders in a string.
 * Returns array of the offending raw tokens. Well-formed = ${NAME} with NAME in [A-Z0-9_]+.
 * A bare `$FOO`, unterminated `${FOO`, or lowercase `${foo}` is malformed.
 */
export function malformedPlaceholders(s) {
  if (typeof s !== 'string') return [];
  const bad = [];
  // Unterminated "${" without a closing "}" before end / next "$".
  for (const m of s.matchAll(/\$\{[^}]*$/g)) bad.push(m[0]);
  // "${...}" whose inner name isn't valid SCREAMING_SNAKE.
  for (const m of s.matchAll(/\$\{([^}]*)\}/g)) {
    if (!/^[A-Z0-9_]+$/.test(m[1])) bad.push(m[0]);
  }
  // Bare "$NAME" (not "${...}") — likely a missing-brace mistake.
  for (const m of s.matchAll(/\$(?!\{)([A-Za-z_][A-Za-z0-9_]*)/g)) bad.push(`$${m[1]}`);
  return [...new Set(bad)];
}

/**
 * Pure: detect a literal value that LOOKS like a secret (i.e. a sensitive key whose value
 * is not a ${ENV_VAR} placeholder). `keyPath` is dotted context for the message.
 * Returns array of { keyPath, value } findings.
 */
export function secretLiterals(value, keyPath = '') {
  const out = [];
  const lastKey = keyPath.split('.').pop() || '';
  if (typeof value === 'string') {
    if (SECRET_KEY_RE.test(lastKey) && !isFullPlaceholder(value)) {
      out.push({ keyPath, value });
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...secretLiterals(v, `${keyPath}[${i}]`)));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(...secretLiterals(v, keyPath ? `${keyPath}.${k}` : k));
    }
  }
  return out;
}

/** Pure: collect every string leaf in a value, with dotted key paths. */
function collectStrings(value, keyPath, acc) {
  if (typeof value === 'string') { acc.push({ keyPath, value }); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => collectStrings(v, `${keyPath}[${i}]`, acc)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, keyPath ? `${keyPath}.${k}` : k, acc);
  }
}

/** Pure: walk an object for any EXTERNAL_REF_KEYS at any depth. Returns offending key paths. */
export function externalRefs(value, keyPath = '') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...externalRefs(v, `${keyPath}[${i}]`)));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const here = keyPath ? `${keyPath}.${k}` : k;
      if (EXTERNAL_REF_KEYS.includes(k)) out.push(here);
      out.push(...externalRefs(v, here));
    }
  }
  return out;
}

/**
 * Pure: validate one parsed-or-raw `.mcp.json` config.
 * Accepts either raw text (string) or an already-parsed object.
 * Returns { ok, errors, servers: [{name, alwaysLoad}] }.
 */
export function validateConfig(input, label = '<config>') {
  const errors = [];
  let cfg = input;
  if (typeof input === 'string') {
    try { cfg = JSON.parse(input); }
    catch (e) { return { ok: false, errors: [`${label}: invalid JSON (${e.message})`], servers: [] }; }
  }

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, errors: [`${label}: root must be a JSON object`], servers: [] };
  }

  // (a) mcpServers object present
  const ms = cfg.mcpServers;
  if (!ms || typeof ms !== 'object' || Array.isArray(ms)) {
    errors.push(`${label}: missing or non-object "mcpServers"`);
  }

  // (d) self-contained: only allowed top-level keys + no external-ref keys anywhere
  for (const k of Object.keys(cfg)) {
    if (!ALLOWED_TOP_KEYS.has(k)) errors.push(`${label}: disallowed top-level key "${k}" (only ${[...ALLOWED_TOP_KEYS].join(', ')})`);
  }
  for (const ref of externalRefs(cfg)) {
    errors.push(`${label}: external reference key "${ref}" breaks --strict-mcp-config self-containment`);
  }

  const servers = [];
  if (ms && typeof ms === 'object' && !Array.isArray(ms)) {
    for (const [name, entry] of Object.entries(ms)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${label}: server "${name}" must be an object`);
        continue;
      }
      // must declare a transport
      if (!('command' in entry) && !('url' in entry)) {
        errors.push(`${label}: server "${name}" must declare "command" or "url"`);
      }
      // (b) no secret-looking literals
      for (const f of secretLiterals(entry, name)) {
        errors.push(`${label}: server "${f.keyPath}" looks like a secret literal — use \${ENV_VAR} (got ${JSON.stringify(f.value)})`);
      }
      // (c) well-formed placeholders across all string leaves
      const strings = [];
      collectStrings(entry, name, strings);
      for (const { keyPath, value } of strings) {
        for (const bad of malformedPlaceholders(value)) {
          errors.push(`${label}: server "${keyPath}" has malformed placeholder "${bad}" (use \${SCREAMING_SNAKE} or \${CLAUDE_PROJECT_DIR})`);
        }
      }
      servers.push({ name, alwaysLoad: entry.alwaysLoad === true });
    }
  }

  return { ok: errors.length === 0, errors, servers };
}

/** Pure: list of all framework/packs/<pack>/.mcp.json paths under a repo root. */
export function findPackMcpFiles(repo) {
  const packsDir = join(repo, 'framework', 'packs');
  const out = [];
  if (!existsSync(packsDir)) return out;
  for (const e of readdirSync(packsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(packsDir, e.name, '.mcp.json');
    if (existsSync(p)) out.push(p);
  }
  return out;
}

function main() {
  const repoArgIdx = process.argv.indexOf('--repo');
  const repo = repoArgIdx >= 0 ? process.argv[repoArgIdx + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..');

  const files = findPackMcpFiles(repo);
  let errorCount = 0;

  if (files.length === 0) {
    process.stdout.write('[validate-pack-mcp] no framework/packs/*/.mcp.json files found\n');
  }

  for (const file of files) {
    const rel = file.replace(repo, '.').replace(/\\/g, '/');
    const { errors, servers } = validateConfig(readFileSync(file, 'utf8'), rel);
    for (const e of errors) { process.stdout.write(`[validate-pack-mcp] ERROR ${e}\n`); errorCount++; }
    const always = servers.filter((s) => s.alwaysLoad).map((s) => s.name);
    const deferred = servers.filter((s) => !s.alwaysLoad).map((s) => s.name);
    process.stdout.write(
      `[validate-pack-mcp] ${rel}: ${servers.length} server(s) — ` +
      `alwaysLoad=[${always.join(', ') || 'none'}] deferred=[${deferred.join(', ') || 'none'}]\n`,
    );
  }

  process.stdout.write(`[validate-pack-mcp] ${files.length} file(s), ${errorCount} error(s)\n`);
  process.exit(errorCount > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
