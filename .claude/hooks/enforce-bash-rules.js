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
];

// Strip quoted strings so patterns inside commit messages / echo content don't false-positive.
function stripQuotes(command) {
  return (command || '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
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

// Scan targets: the top-level command (quotes stripped, so commit messages don't false-positive)
// PLUS the inner content of any -c argument (its own quotes stripped). Patterns run against all.
function scanTargets(command) {
  return [stripQuotes(command), ...extractDashCContents(command).map(stripQuotes)];
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

module.exports = { matchBlocked, matchDestructive, stripQuotes, BLOCKED_PATTERNS, DESTRUCTIVE_PATTERNS };
