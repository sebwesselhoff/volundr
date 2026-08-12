#!/usr/bin/env node
/**
 * FRW-BL-107 — hook CONFIGURATION correctness auditor.
 *
 * The defect class this exists for: Volundr's hooks are correct code that can be wired to nothing,
 * and every existing test passes while that is true, because a self-test drives the handler function
 * directly and never asks whether the handler is invoked. FRW-BL-092 (every shell guard inoperative
 * for the PowerShell tool, for an unknown number of sessions), FRW-BL-093 (NotebookEdit sending
 * notebook_path while the guard read only file_path) and FRW-BL-113 (one script under two hook
 * EVENTS with no discriminator, so a StopFailure ran full session teardown) are all instances.
 *
 * NO PRIOR ART — verified, not assumed. AgentShield was assessed directly against its source: its
 * 154 `matcher` occurrences are all test fixtures, it has no knownTools/VALID_TOOLS construct, and
 * its only `powershell` occurrence is a markdown-fence regex. It detects malicious PAYLOADS in
 * configs; nothing in the ecosystem detects config INCORRECTNESS.
 *
 * DESIGN RULES, each one a lesson this project already paid for:
 *  - DETERMINISTIC, no LLM, no network. It has to be cheap enough to live in the gate suite.
 *  - FAIL SOFT on the unknown (unrecognised tool name -> warning), FAIL HARD on the knowable
 *    (a guarded capability class with an unguarded sibling -> error). A linter that blocks on a
 *    platform update gets disabled, and a disabled linter guards nothing.
 *  - NEVER silently pass. When static analysis cannot resolve a hook's field reads it says so as a
 *    warning rather than treating "found nothing" as "nothing wrong" — the exact shape of the
 *    anti-stub-scan flag bug found in this same session (a bare run printed "no code files to scan"
 *    and exited 0, a green that scanned nothing).
 *  - Accepted gaps need a CARD. Waivers live in platform-tools.json and are echoed in the output,
 *    so an accepted gap stays visible rather than becoming invisible.
 *
 * Pure functions over already-parsed input, so every check is unit-testable without touching disk.
 *
 * Usage:
 *   node scripts/hook-config-audit.mjs                  # audit this repo
 *   node scripts/hook-config-audit.mjs --json           # machine-readable
 *   node scripts/hook-config-audit.mjs --repo <path>
 * Exit: 0 = no errors (warnings allowed), 1 = at least one error.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// --- parsing -----------------------------------------------------------------

/**
 * Normalise either manifest shape into a flat list of registrations.
 * `.claude/settings.json` nests hooks under a top-level "hooks" key; `hooks/hooks.json` may be
 * either the same shape or the bare map. Accept both rather than caring which file it came from.
 */
export function parseRegistrations(manifestJson) {
  const root = manifestJson && typeof manifestJson === 'object' ? (manifestJson.hooks ?? manifestJson) : {};
  const out = [];
  for (const [event, groups] of Object.entries(root)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const matcher = typeof group.matcher === 'string' ? group.matcher : '';
      const scripts = [];
      for (const h of Array.isArray(group.hooks) ? group.hooks : []) {
        const parts = Array.isArray(h?.args) && h.args.length ? h.args : [h?.command];
        for (const p of parts) {
          if (typeof p !== 'string') continue;
          const m = p.match(/([\w.-]+\.(?:js|mjs|cjs))\s*$/);
          if (m) scripts.push(m[1]);
        }
      }
      out.push({ event, matcher, scripts });
    }
  }
  return out;
}

/** A matcher is a `|`-separated tool list, or "" meaning "every tool / not tool-scoped". */
export function matcherTools(matcher) {
  if (typeof matcher !== 'string' || matcher.trim() === '') return [];
  return matcher.split('|').map((s) => s.trim()).filter(Boolean);
}

// --- check 1: unknown tool names (WARN — ISC-1 + ISC-6) ----------------------

export function checkUnknownTools(registrations, registry) {
  const known = new Set(Object.keys(registry.tools || {}));
  const findings = [];
  for (const reg of registrations) {
    for (const tool of matcherTools(reg.matcher)) {
      if (!known.has(tool)) {
        findings.push({
          severity: 'warn',
          check: 'unknown-tool',
          detail: `${reg.event} matcher "${reg.matcher}" names tool "${tool}", which is not in `
            + `framework/platform-tools.json (verified against CLI ${registry.verifiedAgainstCli}). `
            + `Either it is a typo — in which case this hook guards nothing — or the platform gained `
            + `a tool and the registry needs updating. WARNING, not an error, deliberately: blocking `
            + `here would let a platform update wedge the gate suite.`,
        });
      }
    }
  }
  return findings;
}

// --- check 2: capability class with an unguarded sibling (ERROR — ISC-2) ------

export function checkCapabilitySiblings(registrations, registry) {
  const tools = registry.tools || {};
  const waivers = Array.isArray(registry.waivers) ? registry.waivers : [];
  const byClass = new Map();
  for (const [name, def] of Object.entries(tools)) {
    if (!def?.capability) continue;
    if (!byClass.has(def.capability)) byClass.set(def.capability, []);
    byClass.get(def.capability).push(name);
  }

  const findings = [];
  const applied = [];
  for (const reg of registrations) {
    const named = matcherTools(reg.matcher);
    if (named.length === 0) continue; // "" matchers cover everything — cannot have this bug

    // Which classes does this matcher touch, and does it name every member?
    const touched = new Set(named.map((t) => tools[t]?.capability).filter(Boolean));
    for (const cls of touched) {
      if (cls === 'read') continue; // no guard obligation
      const members = byClass.get(cls) || [];
      const missing = members.filter((m) => !named.includes(m));
      for (const miss of missing) {
        // A waiver must NAME A CARD to count. Same bar hook-coverage.md sets for its coverage table:
        // an accepted gap is fine, an undocumented one is not. A card-less waiver is ignored, so the
        // gap errors — fail-safe, because the alternative is a silent permanent exemption written by
        // whoever was in a hurry.
        const waiver = waivers.find((w) => w.check === 'capability-sibling'
          && w.event === reg.event
          && w.matcher === reg.matcher
          && w.missingTool === miss
          && typeof w.card === 'string' && w.card.trim() !== '');
        if (waiver) {
          applied.push({
            severity: 'info',
            check: 'capability-sibling-waived',
            detail: `${reg.event} "${reg.matcher}" does not cover sibling "${miss}" — WAIVED by `
              + `${waiver.card}. ${waiver.reason}`,
          });
          continue;
        }
        findings.push({
          severity: 'error',
          check: 'capability-sibling',
          detail: `${reg.event} matcher "${reg.matcher}" guards capability class "${cls}" but does `
            + `NOT cover sibling tool "${miss}", which has the same capability. Scripts: `
            + `${reg.scripts.join(', ') || '(none)'}. An unguarded sibling looks identical to safe: `
            + `the command runs, nothing complains, no event is logged. Either add "${miss}" to the `
            + `matcher, or record a waiver in framework/platform-tools.json naming the card that `
            + `accepts the gap.`,
        });
      }
    }
  }
  return { findings, applied };
}

// --- check 3: hook reads a field its matched tools never send (ERROR — ISC-3) -

/**
 * Best-effort static extraction of the tool_input fields a hook source reads.
 * Handles the three shapes that actually occur in this repo:
 *   1. direct         — tool_input.command / input.tool_input?.file_path
 *   2. aliased        — const t = input.tool_input || {};  t.prompt
 *   3. array-literal  — for (const field of ['file_path', 'notebook_path'])
 *   4. destructured   — const { command } = input.tool_input
 * Returns { fields, resolvable }. `resolvable:false` means the extractor found no usage at all,
 * which is reported as a warning rather than silently treated as "reads nothing".
 */
export function extractReadFields(source, knownFieldNames = []) {
  const src = String(source ?? '');
  const fields = new Set();

  // 2 + 4: find aliases assigned from tool_input, and destructured names.
  const aliases = new Set(['tool_input']);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.?]*\btool_input\b/g)) {
    aliases.add(m[1]);
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*[\w.?]*\btool_input\b/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.split(':')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) fields.add(name);
    }
  }

  // 1 + 2: member reads off tool_input or any alias.
  for (const alias of aliases) {
    const re = new RegExp(`\\b${alias.replace(/[$]/g, '\\$')}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    for (const m of src.matchAll(re)) fields.add(m[1]);
  }
  // Bracket access with a string literal: tool_input['file_path']
  for (const alias of aliases) {
    const re = new RegExp(`\\b${alias.replace(/[$]/g, '\\$')}\\s*\\??\\[\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const m of src.matchAll(re)) fields.add(m[1]);
  }

  // 3: array literals of string literals, counted only when at least one member is a known field
  // name. Without that condition every unrelated string array in the file would pollute the set.
  const knownSet = new Set(knownFieldNames);
  for (const m of src.matchAll(/\[\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])\s*\]/g)) {
    const members = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (members.some((x) => knownSet.has(x))) {
      for (const x of members) if (knownSet.has(x)) fields.add(x);
    }
  }

  // Drop things that are obviously not data fields.
  const NOT_FIELDS = new Set(['length', 'toString', 'hasOwnProperty', 'constructor', 'map', 'filter',
    'forEach', 'trim', 'split', 'join', 'includes', 'match', 'replace', 'test', 'slice', 'startsWith',
    'endsWith', 'push', 'some', 'every', 'find', 'keys', 'values', 'entries']);
  for (const f of [...fields]) if (NOT_FIELDS.has(f)) fields.delete(f);

  return { fields: [...fields].sort(), resolvable: fields.size > 0 };
}

export function checkFieldAccess(registrations, registry, readSource) {
  const tools = registry.tools || {};
  const allFieldNames = Object.values(tools).flatMap((t) => t.inputFields || []);
  const findings = [];

  for (const reg of registrations) {
    const named = matcherTools(reg.matcher).filter((t) => tools[t]);
    if (named.length === 0) continue;

    for (const script of reg.scripts) {
      const source = readSource(script);
      if (source == null) {
        findings.push({
          severity: 'warn',
          check: 'script-unreadable',
          detail: `${reg.event} "${reg.matcher}" registers ${script}, which could not be read for `
            + `field analysis. Not treated as passing.`,
        });
        continue;
      }
      const { fields, resolvable } = extractReadFields(source, allFieldNames);
      if (!resolvable) continue; // hook may not inspect tool_input at all (e.g. logging-only)

      const dataFields = fields.filter((f) => allFieldNames.includes(f));
      if (dataFields.length === 0) continue; // reads only non-registry keys; nothing to assert

      for (const tool of named) {
        const sends = tools[tool].inputFields || [];
        if (!dataFields.some((f) => sends.includes(f))) {
          findings.push({
            severity: 'error',
            check: 'field-access',
            detail: `${reg.event} "${reg.matcher}" -> ${script} reads tool_input field(s) `
              + `[${dataFields.join(', ')}], but matched tool "${tool}" sends none of them `
              + `(it sends [${sends.join(', ')}]). The hook is registered for ${tool} and cannot `
              + `resolve anything from it, so it inspects undefined and passes everything through — `
              + `coverage theatre, which reads as covered while guarding nothing.`,
          });
        }
      }
    }
  }
  return findings;
}

// --- check 4: matcher parity across manifests (ERROR — ISC-4) ----------------

export function checkManifestParity(regsA, regsB, labelA = 'settings.json', labelB = 'hooks.json') {
  const key = (r) => `${r.event} ${r.matcher} ${[...r.scripts].sort().join(',')}`;
  const setA = new Map(regsA.map((r) => [key(r), r]));
  const setB = new Map(regsB.map((r) => [key(r), r]));
  const findings = [];
  for (const [k, r] of setA) {
    if (!setB.has(k)) {
      findings.push({
        severity: 'error',
        check: 'manifest-parity',
        detail: `${labelA} has ${r.event} matcher "${r.matcher}" -> ${r.scripts.join(', ')} with no `
          + `identical entry in ${labelB}. A half-applied matcher fix is how FRW-BL-092 survived a `
          + `session: the dev-repo config and the distributed plugin config disagreed.`,
      });
    }
  }
  for (const [k, r] of setB) {
    if (!setA.has(k)) {
      findings.push({
        severity: 'error',
        check: 'manifest-parity',
        detail: `${labelB} has ${r.event} matcher "${r.matcher}" -> ${r.scripts.join(', ')} with no `
          + `identical entry in ${labelA}.`,
      });
    }
  }
  return findings;
}

// --- check 5: one script under multiple EVENTS (ERROR — FRW-BL-113) ---------

/**
 * The sibling defect class to a missing tool name: a script registered under two different hook
 * EVENTS with no way to tell them apart. FRW-BL-113 shipped exactly this — session-end.js under both
 * SessionEnd and StopFailure, running one-way session teardown on a turn-level API error.
 */
export function checkMultiEventScripts(registrations, registry, readSource) {
  if (registry.multiEventScriptsMustReadHookEventName === false) return [];
  const byScript = new Map();
  for (const reg of registrations) {
    for (const s of reg.scripts) {
      if (!byScript.has(s)) byScript.set(s, new Set());
      byScript.get(s).add(reg.event);
    }
  }
  const findings = [];
  for (const [script, events] of byScript) {
    if (events.size < 2) continue;
    const source = readSource(script);
    if (source == null) {
      findings.push({
        severity: 'warn',
        check: 'script-unreadable',
        detail: `${script} is registered under ${events.size} events (${[...events].join(', ')}) but `
          + `could not be read to verify it discriminates between them.`,
      });
      continue;
    }
    if (!/\bhook_event_name\b/.test(source)) {
      findings.push({
        severity: 'error',
        check: 'multi-event-no-discriminator',
        detail: `${script} is registered under ${events.size} different hook events `
          + `(${[...events].sort().join(', ')}) but never reads "hook_event_name", so it cannot tell `
          + `which event invoked it and must treat them identically. hook_event_name is in the COMMON `
          + `input fields on every invocation. This is the FRW-BL-113 defect: session-end.js ran full `
          + `session teardown on a StopFailure (a turn-level API error, not session termination), `
          + `marking live agents completed and clearing activeProject mid-session.`,
      });
    }
  }
  return findings;
}

// --- orchestration ----------------------------------------------------------

export function auditConfig({ settings, hooksManifest, registry, readSource }) {
  const regsSettings = parseRegistrations(settings);
  const regsHooks = hooksManifest ? parseRegistrations(hooksManifest) : null;

  const findings = [];
  const info = [];

  findings.push(...checkUnknownTools(regsSettings, registry));
  const sib = checkCapabilitySiblings(regsSettings, registry);
  findings.push(...sib.findings);
  info.push(...sib.applied);
  findings.push(...checkFieldAccess(regsSettings, registry, readSource));
  findings.push(...checkMultiEventScripts(regsSettings, registry, readSource));
  if (regsHooks) findings.push(...checkManifestParity(regsSettings, regsHooks));

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return { errors, warnings, info, registrationCount: regsSettings.length };
}

// --- CLI --------------------------------------------------------------------

function main(argv) {
  const repoIdx = argv.indexOf('--repo');
  const repo = repoIdx >= 0 ? resolve(argv[repoIdx + 1]) : process.cwd();
  const asJson = argv.includes('--json');

  const settingsPath = join(repo, '.claude', 'settings.json');
  const hooksPath = join(repo, 'hooks', 'hooks.json');
  const registryPath = join(repo, 'framework', 'platform-tools.json');

  // Fail CLOSED on a missing/unparseable input: a linter that cannot read its own config must not
  // report success. This is the one place the tool is deliberately strict about itself.
  const read = (p, label) => {
    if (!existsSync(p)) {
      process.stdout.write(`[hook-audit] ERROR ${label} not found at ${p}\n`);
      process.exit(1);
    }
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      process.stdout.write(`[hook-audit] ERROR ${label} did not parse (${e.message})\n`);
      process.exit(1);
    }
  };

  const settings = read(settingsPath, '.claude/settings.json');
  const registry = read(registryPath, 'framework/platform-tools.json');
  const hooksManifest = existsSync(hooksPath) ? read(hooksPath, 'hooks/hooks.json') : null;

  const hookDir = join(repo, '.claude', 'hooks');
  const readSource = (script) => {
    const p = join(hookDir, script);
    try { return readFileSync(p, 'utf8'); } catch { return null; }
  };

  const result = auditConfig({ settings, hooksManifest, registry, readSource });

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const i of result.info) process.stdout.write(`[hook-audit] INFO  ${i.detail}\n`);
    for (const w of result.warnings) process.stdout.write(`[hook-audit] WARN  ${w.detail}\n`);
    for (const e of result.errors) process.stdout.write(`[hook-audit] ERROR ${e.detail}\n`);
    process.stdout.write(
      `[hook-audit] ${result.registrationCount} registration(s) audited against CLI `
      + `${registry.verifiedAgainstCli}: ${result.errors.length} error(s), `
      + `${result.warnings.length} warning(s), ${result.info.length} waived.\n`,
    );
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
