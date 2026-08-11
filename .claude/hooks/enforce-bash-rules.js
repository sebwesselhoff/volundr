// enforce-bash-rules.js - PreToolUse:Bash hook
// Two tiers (HARD enforcement, exit 2):
//   1. BLOCKED_PATTERNS — catastrophic / framework-forbidden, no escape hatch.
//   2. DESTRUCTIVE_PATTERNS (FRW-BL-051) — history rewrite / discards work / drops data.
//      Blocked UNLESS the operator has approved via VLDR_ALLOW_DESTRUCTIVE=1, in which case the
//      command is allowed and the approval is logged as a RECEIPT in the dashboard event log.
// Fast path (no destructive match) stays synchronous + API-free.
//
// SCOPE: this is DEFENSE-IN-DEPTH, not a sandbox. It catches the common/accidental destructive
// commands by pattern. A determined actor can obfuscate (var expansion, command substitution,
// `rm -r -f`, base64, chaining) past a regex guard — the real isolation boundaries are git
// worktree isolation + Claude Code permission modes. The value here is stopping the routine
// "oops" (a subagent running rm -rf / reset --hard), with an operator-approval receipt trail.

const { readStdin, apiPost, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('enforce-bash-rules');

// Always blocked — no escape.
const BLOCKED_PATTERNS = [
  { pattern: /git\s+add\s+(-A\b|--all\b|\.(\s|$))/, message: "BLOCKED: Use specific file paths instead of 'git add -A'. Example: git add src/file1.ts src/file2.ts" },
  { pattern: /claude\s+(-p|--print)\b/, message: "BLOCKED: 'claude -p' hangs in nested sessions. Use the Agent tool instead." },
  { pattern: /git\s+push\s+--force(?!-)/, message: "BLOCKED: Force push prohibited. Use --force-with-lease if needed." },
  { pattern: /rm\s+-rf\s+\//, message: "BLOCKED: Destructive rm -rf / not allowed." },
  // FRW-BL-092 (residual gap) — the Windows analogue of `rm -rf /`. Never legitimate here, so it
  // sits in the no-escape tier alongside it rather than behind VLDR_ALLOW_DESTRUCTIVE.
  { pattern: /\b(?:Format-Volume|Clear-Disk)\b/i, message: "BLOCKED: Format-Volume / Clear-Disk destroys an entire volume." },
];

// Destructive — gated behind operator approval (VLDR_ALLOW_DESTRUCTIVE=1), logged as a receipt.
const DESTRUCTIVE_PATTERNS = [
  { pattern: /git\s+reset\s+--hard\b/, label: 'git reset --hard (discards working changes)' },
  { pattern: /git\s+clean\s+-[a-z]*f[a-z]*d|git\s+clean\s+-[a-z]*d[a-z]*f/i, label: 'git clean -fd (deletes untracked files/dirs)' },
  { pattern: /git\s+filter-branch\b/, label: 'git filter-branch (history rewrite)' },
  { pattern: /git\s+push\b.*\s-f\b/, label: 'git force-push (-f)' },
  { pattern: /git\s+push\b.*\s\+\S+/, label: 'git force-push (+refspec)' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, label: 'rm -rf (recursive force delete)' },
  { pattern: /\bDROP\s+(DATABASE|SCHEMA|TABLE)\b/i, label: 'SQL DROP DATABASE/SCHEMA/TABLE' },

  // FRW-BL-092 (residual gap) — everything above this line is POSIX-shaped. Registering the hook
  // for the PowerShell tool fixed the `git` tier there for free, because git spells the same in
  // every shell (proven live: filter-branch and `add -A` both blocked via PowerShell). It did NOT
  // fix the FILESYSTEM tier: PowerShell's `rm` alias rejects the bundled `-rf`, so `rm -rf` is
  // unreachable prose on the primary shell of this machine, while the form a PowerShell caller
  // actually writes — `Remove-Item -Recurse -Force` — matched nothing at all. Verified by probe,
  // not by inspection: a nested canary tree under TEMP was deleted UNGUARDED through the
  // PowerShell tool minutes after the git tier was proven blocked on that same tool.
  { pattern: /\b(?:Remove-Item|rmdir|rd|del|erase|ri)\b[^|;&\n]*\s(?:-Recurse\b|-Rec\b|-r\b|\/[sS]\b)/i, label: 'recursive delete (PowerShell/cmd: Remove-Item -Recurse, rd /s, del /s)' },
  // The pipeline idiom: the -Recurse sits on the producer, so it is never in the same segment as
  // the deleting verb and the pattern above cannot see it.
  { pattern: /Get-Child(?:Item)?\b[^\n]*-Recurse\b[^\n]*\|\s*(?:Remove-Item|rm\b|ri\b|del\b)/i, label: 'recursive delete via pipeline (Get-ChildItem -Recurse | Remove-Item)' },
  { pattern: /\bClear-Content\b/i, label: 'Clear-Content (truncates file contents in place)' },
];

// Strip quoted strings so patterns inside commit messages / echo content don't false-positive.
function stripQuotes(command) {
  return (command || '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

// FRW-BL-090 — remove heredoc BODIES before matching. A heredoc body is not a quoted string, so
// stripQuotes leaves it intact and a document that merely WRITES ABOUT a forbidden command was
// blocked as if it were running one. In a self-documenting framework that happens often: the
// observed false positive was a heredoc containing the nested-session CLI flag as prose.
//
// Returns { text, unterminated }. `unterminated` is the fail-closed signal: if a heredoc is opened
// and never closed we cannot know where its body ends, so callers must scan the ORIGINAL text
// rather than risk hiding a real command inside an unterminated body.
function stripHeredocs(command) {
  const src = command || '';
  if (!src.includes('<<')) return { text: src, unterminated: false };

  const lines = src.split('\n');
  const out = [];
  let i = 0;
  let unterminated = false;

  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    i++;

    // `<<WORD`, `<<-WORD`, `<<'WORD'`, `<<"WORD"`. A here-STRING (`<<<`) is not a heredoc: its
    // delimiter pattern requires a letter/underscore or quote right after the optional `-`, and
    // `<` is neither, so `<<<foo` never matches here.
    const openers = [...line.matchAll(/<<(-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g)];

    for (const m of openers) {
      const allowIndent = m[1] === '-';
      const delim = m[2] || m[3] || m[4];
      let closed = false;
      while (i < lines.length) {
        const bodyLine = lines[i];
        i++;
        const candidate = allowIndent ? bodyLine.replace(/^\t+/, '') : bodyLine;
        if (candidate.trim() === delim) { out.push(bodyLine); closed = true; break; }
        out.push(''); // body dropped, line count preserved
      }
      if (!closed) unterminated = true;
    }
  }

  return { text: out.join('\n'), unterminated };
}

// Remove shell comments. Runs AFTER stripQuotes, so a `#` inside a quoted string is already gone
// and cannot truncate a real command. A commented-out command is never executed, so matching it
// is a false positive by definition.
function stripComments(text) {
  return (text || '')
    .split('\n')
    .map(line => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

// Extract the content of any `-c <quoted|token>` argument (bash/sh/psql -c "..."). These carry
// a literal command to EXECUTE, so a destructive command hidden there must be scanned —
// otherwise top-level stripQuotes erases it (e.g. `sh -c 'rm -rf /'` would bypass even the
// hard block). FRW-BL-051 hardening (adversarial finding).
function extractDashCContents(command) {
  const out = [];
  const re = /-c\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g;
  let m;
  while ((m = re.exec(command || ''))) {
    let arg = m[1];
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) arg = arg.slice(1, -1);
    out.push(arg);
  }
  return out;
}

// Scan targets: the top-level command PLUS the inner content of any -c argument. Each target has
// its non-command context removed first — heredoc bodies (FRW-BL-090), then quoted strings, then
// comments — so that WRITING a forbidden command is distinguished from RUNNING one.
//
// Order matters: heredocs are stripped from the RAW text, because stripQuotes would otherwise
// mangle a quoted delimiter (`<<'EOF'` -> `<<''`) and the body would never be found.
//
// FAIL CLOSED: an unterminated heredoc means the body's extent is unknowable, so we fall back to
// the original pre-FRW-BL-090 behaviour (quote-stripping only) and keep matching inside it. A
// false positive costs one blocked call; a false negative costs a hung nested session.
function scanTargets(command) {
  const { text, unterminated } = stripHeredocs(command || '');
  if (unterminated) {
    return [stripQuotes(command), ...extractDashCContents(command).map(stripQuotes)];
  }
  const clean = (s) => stripComments(stripQuotes(s));
  return [clean(text), ...extractDashCContents(text).map(clean)];
}

function matchBlocked(command) {
  for (const t of scanTargets(command)) {
    for (const { pattern, message } of BLOCKED_PATTERNS) if (pattern.test(t)) return message;
  }
  return null;
}

function matchDestructive(command) {
  for (const t of scanTargets(command)) {
    for (const d of DESTRUCTIVE_PATTERNS) if (d.pattern.test(t)) return d.label;
  }
  return null;
}

async function main() {
  const input = readStdin();
  const command = input.tool_input?.command || '';

  const blockedMsg = matchBlocked(command);
  if (blockedMsg) {
    log.warn('bash_rule_blocked', blockedMsg, { command: command.slice(0, 200) });
    process.stderr.write(blockedMsg + '\n');
    process.exit(2);
  }

  const destructive = matchDestructive(command);
  if (destructive) {
    if (process.env.VLDR_ALLOW_DESTRUCTIVE) {
      // Operator-approved → allow + log an approval RECEIPT in the event log (ISC-3).
      log.warn('destructive_approved', `Approved destructive command: ${destructive}`, { command: command.slice(0, 200) });
      if (PROJECT_ID) {
        try {
          await apiPost('/api/events', {
            projectId: PROJECT_ID,
            type: 'intervention',
            detail: `Destructive command APPROVED (VLDR_ALLOW_DESTRUCTIVE): ${destructive} — ${command.slice(0, 160)}`,
          });
        } catch { /* receipt is best-effort, never block on it */ }
      }
      process.stderr.write(`[destructive-guard] APPROVED (${destructive}) — receipt logged to the event log.\n`);
      return; // exit 0 — allowed
    }
    const msg = `BLOCKED (destructive-guard, FRW-BL-051): ${destructive}. This rewrites history / discards work / drops data. `
      + `Re-run with VLDR_ALLOW_DESTRUCTIVE=1 to authorize (logged as a receipt), or use a safer alternative `
      + `(--force-with-lease, git stash, git worktree remove, a soft/mixed reset).`;
    log.warn('destructive_blocked', msg, { command: command.slice(0, 200) });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((e) => { try { log.error('unhandled_error', e.message); } catch { /* ignore */ } });
}

module.exports = {
  matchBlocked, matchDestructive, stripQuotes, stripHeredocs, stripComments, scanTargets,
  BLOCKED_PATTERNS, DESTRUCTIVE_PATTERNS,
};
