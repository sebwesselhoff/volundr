// hook-config-audit.test.mjs — self-test for the FRW-BL-107 hook configuration auditor.
// Run: node scripts/hook-config-audit.test.mjs
// No test framework, no network, no disk writes. Dependency-free by design, like its siblings.
//
// The load-bearing tests are the HISTORICAL FIXTURES: FRW-BL-092, FRW-BL-093 and FRW-BL-113 are
// reproduced against their real PRE-FIX configuration and must be CAUGHT, then against their
// POST-FIX configuration and must PASS. Those three are the only ground truth this project has —
// they are defects that actually shipped here and cost real sessions. A linter that only catches
// invented fixtures proves nothing about the class of bug it claims to prevent.

import { readFileSync } from 'fs';
import {
  parseRegistrations, matcherTools, checkUnknownTools, checkCapabilitySiblings,
  checkFieldAccess, checkManifestParity, checkMultiEventScripts, extractReadFields, auditConfig,
} from './hook-config-audit.mjs';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

const repoRoot = new URL('..', import.meta.url);
const REGISTRY = JSON.parse(readFileSync(new URL('framework/platform-tools.json', repoRoot), 'utf8'));

const settingsWith = (hooks) => ({ hooks });
const group = (event, matcher, scripts) => [event, [{ matcher, hooks: scripts.map((s) => ({ command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/${s}`] })) }]];
const noSource = () => '';

// --- parsing ----------------------------------------------------------------
{
  const regs = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Bash|PowerShell', ['enforce-bash-rules.js', 'enforce-worktree-isolation.js']),
  ])));
  ok('parses event, matcher and multiple scripts from a settings.json shape',
    regs.length === 1 && regs[0].event === 'PreToolUse' && regs[0].matcher === 'Bash|PowerShell'
    && regs[0].scripts.join(',') === 'enforce-bash-rules.js,enforce-worktree-isolation.js');

  // hooks/hooks.json may be the bare map with no top-level "hooks" key.
  const bare = parseRegistrations(Object.fromEntries([group('Stop', '', ['session-stop.js'])]));
  ok('parses the bare-map manifest shape too (hooks/hooks.json)',
    bare.length === 1 && bare[0].event === 'Stop' && bare[0].scripts[0] === 'session-stop.js');

  ok('a "" matcher yields no tool names (covers everything, cannot have the sibling bug)',
    matcherTools('').length === 0 && matcherTools('  ').length === 0);
  ok('splits a pipe matcher and trims', matcherTools('Write | Edit').join(',') === 'Write,Edit');
  ok('tolerates junk input without throwing',
    parseRegistrations(null).length === 0 && parseRegistrations({ hooks: { X: 'nope' } }).length === 0);
}

// --- FIXTURE: FRW-BL-092 (shell guards inoperative for PowerShell) -----------
{
  // The real pre-fix registration: matcher "Bash" only. PowerShell was the primary shell on the
  // dev machine and every shell guard was silently inoperative for it.
  const preFix = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Bash', ['enforce-bash-rules.js', 'enforce-worktree-isolation.js']),
  ])));
  const { findings } = checkCapabilitySiblings(preFix, REGISTRY);
  const missing = findings.filter((f) => f.check === 'capability-sibling').map((f) => f.detail).join(' ');
  ok('FIXTURE FRW-BL-092 pre-fix: matcher "Bash" is CAUGHT as leaving shell siblings unguarded',
    findings.some((f) => f.severity === 'error'));
  ok('FRW-BL-092: names BOTH unguarded siblings (PowerShell and Monitor) so the fix is actionable',
    /PowerShell/.test(missing) && /Monitor/.test(missing));

  // Post-fix: the matcher this repo ships today.
  const postFix = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Bash|PowerShell|Monitor', ['enforce-bash-rules.js']),
  ])));
  ok('FIXTURE FRW-BL-092 post-fix: "Bash|PowerShell|Monitor" PASSES',
    checkCapabilitySiblings(postFix, REGISTRY).findings.length === 0);
}

// --- FIXTURE: FRW-BL-093 (NotebookEdit sibling + the half-applied fix) -------
{
  const preFix = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Write|Edit', ['enforce-worktree-path-write.js']),
  ])));
  const sib = checkCapabilitySiblings(preFix, REGISTRY);
  ok('FIXTURE FRW-BL-093 pre-fix: matcher "Write|Edit" is CAUGHT as missing NotebookEdit',
    sib.findings.some((f) => f.severity === 'error' && /NotebookEdit/.test(f.detail)));

  // The HALF-APPLIED fix, which hook-coverage.md calls coverage theatre and explicitly warns is
  // WORSE than the known gap: matcher widened to include NotebookEdit while the code still reads
  // only file_path, so the hook inspects undefined and passes every notebook write through.
  const halfApplied = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Write|Edit|NotebookEdit', ['enforce-worktree-path-write.js']),
  ])));
  const preFixSource = `
    const input = readStdin();
    const target = input.tool_input.file_path;
    if (!target) return;
  `;
  const halfFindings = checkFieldAccess(halfApplied, REGISTRY, () => preFixSource);
  ok('FIXTURE FRW-BL-093 half-applied: matcher widened but code reads only file_path is CAUGHT',
    halfFindings.some((f) => f.severity === 'error' && f.check === 'field-access' && /NotebookEdit/.test(f.detail)));
  ok('FRW-BL-093 half-applied: the message explains it inspects undefined / passes everything',
    halfFindings.some((f) => /undefined|coverage theatre/.test(f.detail)));

  // Post-fix: resolveWriteTarget iterates ['file_path', 'notebook_path'] — the array-literal shape.
  const postFixSource = `
    function resolveWriteTarget(toolInput) {
      for (const field of ['file_path', 'notebook_path']) {
        const v = toolInput?.[field];
        if (typeof v === 'string' && v.trim()) return { field, target: v };
      }
      return null;
    }
  `;
  ok('FIXTURE FRW-BL-093 post-fix: reading file_path OR notebook_path PASSES',
    checkFieldAccess(halfApplied, REGISTRY, () => postFixSource).length === 0);
  ok('FRW-BL-093 post-fix: sibling check also passes with the full matcher',
    checkCapabilitySiblings(halfApplied, REGISTRY).findings.length === 0);
}

// --- FIXTURE: FRW-BL-113 (one script, two events, no discriminator) ---------
{
  const twoEvents = parseRegistrations(settingsWith({
    SessionEnd: [{ matcher: '', hooks: [{ command: 'node', args: ['x/.claude/hooks/session-end.js'] }] }],
    StopFailure: [{ matcher: '', hooks: [{ command: 'node', args: ['x/.claude/hooks/session-end.js'] }] }],
  }));
  const preFixSource = `
    const input = readStdin();
    const reason = input.reason || 'unknown';
    if (reason === 'clear') return;
    // ... completes all running agents, clears activeProject ...
  `;
  const found = checkMultiEventScripts(twoEvents, REGISTRY, () => preFixSource);
  ok('FIXTURE FRW-BL-113 pre-fix: one script under SessionEnd+StopFailure with no hook_event_name is CAUGHT',
    found.some((f) => f.severity === 'error' && f.check === 'multi-event-no-discriminator'));
  ok('FRW-BL-113: names both events so the operator can see the conflation',
    found.some((f) => /SessionEnd/.test(f.detail) && /StopFailure/.test(f.detail)));

  const postFixSource = `
    function isConfirmedSessionEnd(hookEventName) { return hookEventName === 'SessionEnd'; }
    if (!isConfirmedSessionEnd(input.hook_event_name)) return;
  `;
  ok('FIXTURE FRW-BL-113 post-fix: reading hook_event_name PASSES',
    checkMultiEventScripts(twoEvents, REGISTRY, () => postFixSource).length === 0);

  // A script under ONE event has nothing to discriminate and must not be flagged.
  const oneEvent = parseRegistrations(settingsWith(Object.fromEntries([group('Stop', '', ['session-stop.js'])])));
  ok('a script under a single event is NOT flagged (nothing to discriminate)',
    checkMultiEventScripts(oneEvent, REGISTRY, () => preFixSource).length === 0);
}

// --- ISC-1 + ISC-6: unknown tool WARNS, never blocks ------------------------
{
  // cspell:ignore Powershel -- deliberate typo fixture, NOT a word. It must stay misspelled: the
  // whole point is that a plausible near-miss of a real tool name is caught. Adding it to the
  // dictionary would make the repo assert it is a legitimate spelling.
  const typo = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Bash|Powershel', ['enforce-bash-rules.js']),
  ])));
  const w = checkUnknownTools(typo, REGISTRY);
  ok('ISC-1: a matcher naming a nonexistent tool is flagged', w.length === 1);
  ok('ISC-6: it is a WARNING, not an error — a platform update must not wedge the gate suite',
    w[0].severity === 'warn');
  ok('ISC-6: the warning states both possibilities (typo vs new platform tool)',
    /typo/.test(w[0].detail) && /platform gained/.test(w[0].detail));
  ok('a known tool produces no unknown-tool finding',
    checkUnknownTools(parseRegistrations(settingsWith(Object.fromEntries([
      group('PreToolUse', 'Bash|PowerShell|Monitor', ['x.js'])]))), REGISTRY).length === 0);

  // And the exit-code contract: warnings alone must not fail the run.
  const res = auditConfig({ settings: settingsWith(Object.fromEntries([
    group('PreToolUse', 'Bash|PowerShell|Monitor|MadeUpTool', ['enforce-bash-rules.js']),
  ])), hooksManifest: null, registry: REGISTRY, readSource: noSource });
  ok('ISC-6 end-to-end: an unknown tool yields 0 errors and 1 warning, so exit stays 0',
    res.errors.length === 0 && res.warnings.length === 1);
}

// --- ISC-4: manifest parity -------------------------------------------------
{
  const a = parseRegistrations(settingsWith(Object.fromEntries([group('PreToolUse', 'Bash|PowerShell|Monitor', ['g.js'])])));
  const b = parseRegistrations(settingsWith(Object.fromEntries([group('PreToolUse', 'Bash', ['g.js'])])));
  const p = checkManifestParity(a, b);
  ok('ISC-4: a matcher that differs between the two manifests is CAUGHT', p.length === 2 && p.every((f) => f.severity === 'error'));
  ok('ISC-4: identical manifests produce no parity finding', checkManifestParity(a, a).length === 0);
  ok('ISC-4: script-set differences are caught, not just matcher strings',
    checkManifestParity(
      parseRegistrations(settingsWith(Object.fromEntries([group('Stop', '', ['a.js', 'b.js'])]))),
      parseRegistrations(settingsWith(Object.fromEntries([group('Stop', '', ['a.js'])]))),
    ).length === 2);
}

// --- waivers: accepted gaps must name a card -------------------------------
{
  const agentOnly = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Agent', ['pre-agent-tool.js']),
  ])));
  const withWaiver = checkCapabilitySiblings(agentOnly, REGISTRY);
  ok('the live FRW-BL-094 waiver turns the Agent/Workflow gap into INFO, not an error',
    withWaiver.findings.length === 0 && withWaiver.applied.some((i) => /FRW-BL-094/.test(i.detail)));

  const cardless = { ...REGISTRY, waivers: [{ check: 'capability-sibling', event: 'PreToolUse', matcher: 'Agent', missingTool: 'Workflow', reason: 'because' }] };
  ok('a waiver with NO card is IGNORED, so the gap still errors (fail-safe)',
    checkCapabilitySiblings(agentOnly, cardless).findings.some((f) => f.severity === 'error'));

  const blankCard = { ...REGISTRY, waivers: [{ check: 'capability-sibling', event: 'PreToolUse', matcher: 'Agent', missingTool: 'Workflow', card: '   ', reason: 'x' }] };
  ok('a waiver with a blank card string is also ignored',
    checkCapabilitySiblings(agentOnly, blankCard).findings.some((f) => f.severity === 'error'));
}

// --- field extraction: the three real shapes + the traps -------------------
{
  const known = Object.values(REGISTRY.tools).flatMap((t) => t.inputFields || []);
  ok('extracts a direct read (tool_input.command)',
    extractReadFields('const c = input.tool_input.command;', known).fields.includes('command'));
  ok('extracts an aliased read (const t = input.tool_input || {}; t.prompt)',
    extractReadFields('const t = input.tool_input || {};\nconst p = t.prompt || "";', known).fields.includes('prompt'));
  ok('extracts a destructured read (const { command } = input.tool_input)',
    extractReadFields('const { command } = input.tool_input;', known).fields.includes('command'));
  ok('extracts an array-literal field list (["file_path","notebook_path"])',
    (() => { const f = extractReadFields("for (const field of ['file_path', 'notebook_path']) {}", known).fields;
      return f.includes('file_path') && f.includes('notebook_path'); })());
  ok('extracts bracket access with a string literal',
    extractReadFields("const v = tool_input['notebook_path'];", known).fields.includes('notebook_path'));
  ok('an unrelated string array does NOT pollute the field set',
    !extractReadFields("const tiers = ['low', 'medium', 'high'];", known).fields.includes('low'));
  ok('method names are not mistaken for data fields',
    !extractReadFields('input.tool_input.command.trim().split("\\n")', known).fields.includes('trim'));
  ok('a hook that never touches tool_input reports resolvable:false rather than "reads nothing"',
    extractReadFields('const x = input.session_id;', known).resolvable === false);

  // REGRESSION, found by this auditor's own blind review against the real enforce-bash-rules.js.
  // `const command = input.tool_input?.command` makes `command` an alias, and the member-read regex
  // then matched ENGLISH PROSE in a comment — "a real command. A commented-out command" — pulling
  // "A" in as a field. Third appearance of the FRW-BL-090 shape (prose read as code) in this repo.
  // Verbatim prose from the file that caused it:
  const proseTrap = `
    const command = input.tool_input?.command || '';
    // and cannot truncate a real command. A commented-out command is never executed.
    log.warn('blocked', msg, { command: command.slice(0, 200) });
  `;
  {
    const r = extractReadFields(proseTrap, known);
    ok('REGRESSION: prose in a comment after an alias name does NOT become a field ("A")',
      !r.fields.includes('A'));
    ok('REGRESSION: the real field is still extracted from the same source (command)',
      r.fields.includes('command'));
    ok('REGRESSION: a method call on the alias is still not a field (slice)',
      !r.fields.includes('slice'));
  }
  ok('an identifier starting uppercase is never treated as a field',
    !extractReadFields('const t = input.tool_input; t.SomeClass; t.CONSTANT;', known).fields.some((f) => /^[A-Z]/.test(f)));
  ok('a block comment mentioning a real field name does not create a read',
    !extractReadFields('/* we used to read tool_input.file_path here */ const x = input.session_id;', known)
      .fields.includes('file_path'));
  ok('a URL in a comment does not break the comment stripper',
    extractReadFields("// see https://example.com/x\nconst c = input.tool_input.command;", known).fields.includes('command'));
  ok('tolerates empty/undefined source without throwing',
    extractReadFields('', known).resolvable === false && extractReadFields(undefined, known).resolvable === false);
}

// --- a field matching NO tool must WARN, not be skipped in silence --------
// Raised by the FRW-BL-107 blind reviewer as an `info` finding: this was the one path in a tool
// whose design rules say "never silently pass" that did exactly that.
{
  const regs = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Write|Edit|NotebookEdit', ['typo-hook.js']),
  ])));
  // A plausible typo: file_pth instead of file_path. No tool sends it.
  const typoSource = 'const t = input.tool_input || {}; const p = t.file_pth;';
  const f = checkFieldAccess(regs, REGISTRY, () => typoSource);
  ok('a tool_input field matching NO tool is WARNED on (plausible source typo), not skipped',
    f.some((x) => x.severity === 'warn' && x.check === 'unknown-field' && /file_pth/.test(x.detail)));
  ok('the unknown-field warning states both causes (hook typo vs stale registry)',
    f.some((x) => x.check === 'unknown-field' && /typo/.test(x.detail) && /out of date/.test(x.detail)));
  ok('unknown-field is a WARNING, never an error — the extractor is heuristic',
    f.filter((x) => x.check === 'unknown-field').every((x) => x.severity === 'warn'));
  ok('a COMMON hook input field read off tool_input is not warned on',
    !checkFieldAccess(regs, REGISTRY, () => 'const t = input.tool_input || {}; const s = t.session_id;')
      .some((x) => x.check === 'unknown-field'));
  ok('legitimate fields produce no unknown-field warning',
    !checkFieldAccess(regs, REGISTRY, () => "for (const field of ['file_path','notebook_path']) {}")
      .some((x) => x.check === 'unknown-field'));
}

// --- unresolvable input must WARN, never silently pass --------------------
{
  const regs = parseRegistrations(settingsWith(Object.fromEntries([
    group('PreToolUse', 'Write|Edit|NotebookEdit', ['missing-hook.js']),
  ])));
  const f = checkFieldAccess(regs, REGISTRY, () => null);
  ok('an unreadable script WARNS (not treated as passing) — no silent green',
    f.length === 1 && f[0].severity === 'warn' && /Not treated as passing/.test(f[0].detail));
}

// --- INTEGRATION: this repo's real config must pass ------------------------
{
  const settings = JSON.parse(readFileSync(new URL('.claude/settings.json', repoRoot), 'utf8'));
  const hooksManifest = JSON.parse(readFileSync(new URL('hooks/hooks.json', repoRoot), 'utf8'));
  const readSource = (s) => { try { return readFileSync(new URL(`.claude/hooks/${s}`, repoRoot), 'utf8'); } catch { return null; } };
  const res = auditConfig({ settings, hooksManifest, registry: REGISTRY, readSource });
  ok(`INTEGRATION: the live repo config has 0 errors${res.errors.length ? ` (${res.errors[0].detail.slice(0, 160)})` : ''}`,
    res.errors.length === 0);
  ok(`INTEGRATION: the live repo config has 0 warnings${res.warnings.length ? ` (${res.warnings[0].detail.slice(0, 160)})` : ''}`,
    res.warnings.length === 0);
  ok('INTEGRATION: every registration in both manifests was audited (>= 20)', res.registrationCount >= 20);
  ok('INTEGRATION: the FRW-BL-094 Agent/Workflow deferral is reported as a visible waiver, not hidden',
    res.info.some((i) => /FRW-BL-094/.test(i.detail)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
