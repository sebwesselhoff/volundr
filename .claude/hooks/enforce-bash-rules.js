// enforce-bash-rules.js - PreToolUse:Bash hook
// Blocks known-dangerous bash command patterns. HARD enforcement (exit 2).
// Synchronous - no API calls needed for speed.

const { readStdin } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('enforce-bash-rules');

const BLOCKED_PATTERNS = [
  { pattern: /git\s+add\s+(-A\b|--all\b|\.(\s|$))/, message: "BLOCKED: Use specific file paths instead of 'git add -A'. Example: git add src/file1.ts src/file2.ts" },
  { pattern: /claude\s+(-p|--print)\b/, message: "BLOCKED: 'claude -p' hangs in nested sessions. Use the Agent tool instead." },
  { pattern: /git\s+push\s+--force\b/, message: "BLOCKED: Force push prohibited. Use --force-with-lease if needed." },
  { pattern: /rm\s+-rf\s+\//, message: "BLOCKED: Destructive rm -rf / not allowed." },
];

function main() {
  const input = readStdin();
  const command = input.tool_input?.command || '';

  // Strip quoted strings and -m "..." arguments to avoid false positives
  // on patterns appearing inside commit messages or echo content
  const stripped = command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')   // replace double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");   // replace single-quoted strings

  for (const { pattern, message } of BLOCKED_PATTERNS) {
    if (pattern.test(stripped)) {
      log.warn('bash_rule_blocked', message, { command: command.slice(0, 200) });
      process.stderr.write(message + '\n');
      process.exit(2);
    }
  }
}

main();
