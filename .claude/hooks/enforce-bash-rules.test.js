// Self-test for enforce-bash-rules.js (FRW-BL-051 destructive-guard + existing blocks).
// Run: node enforce-bash-rules.test.js — exits 0 on success, 1 on failure.
const { matchBlocked, matchDestructive, stripQuotes, BLOCKED_PATTERNS, DESTRUCTIVE_PATTERNS } = require('./enforce-bash-rules.js');

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('enforce-bash-rules self-test\n');

// --- BLOCKED (hard, no escape) ---
ok('blocks git add -A', !!matchBlocked('git add -A'));
ok('blocks git add .', !!matchBlocked('git add .'));
ok('blocks claude -p', !!matchBlocked('claude -p "do thing"'));
ok('blocks git push --force', !!matchBlocked('git push --force origin main'));
ok('blocks rm -rf /', !!matchBlocked('rm -rf /'));
ok('allows git add <file> (specific)', !matchBlocked('git add src/foo.ts src/bar.ts'));

// --- DESTRUCTIVE (approval-gated) ---
ok('destructive: git reset --hard', matchDestructive('git reset --hard HEAD~2') === 'git reset --hard (discards working changes)');
ok('destructive: git clean -fd', !!matchDestructive('git clean -fd'));
ok('destructive: git clean -fdx', !!matchDestructive('git clean -fdx'));
ok('destructive: git filter-branch', !!matchDestructive('git filter-branch --tree-filter x HEAD'));
ok('destructive: git push -f', !!matchDestructive('git push -f origin feature'));
ok('destructive: rm -rf <path>', !!matchDestructive('rm -rf node_modules'));
ok('destructive: rm -fr <path>', !!matchDestructive('rm -fr build'));
ok('destructive: DROP TABLE (unquoted)', !!matchDestructive('echo DROP TABLE users | psql'));

// --- bypass closure: a destructive command hidden in a -c argument (adversarial finding) ---
ok('bypass: bash -c "rm -rf /" still hard-blocked', !!matchBlocked('bash -c "rm -rf /"'));
ok("bypass: sh -c 'rm -rf /important' caught", !!matchBlocked("sh -c 'rm -rf /important'") || !!matchDestructive("sh -c 'rm -rf /important'"));
ok('bypass: bash -c "git reset --hard" caught', !!matchDestructive('bash -c "git reset --hard"'));
ok('bypass: psql -c "DROP TABLE users" caught', !!matchDestructive('psql -c "DROP TABLE users"'));
// --- uppercase / alternate flags ---
ok('destructive: rm -Rf (uppercase R)', !!matchDestructive('rm -Rf build'));
ok('destructive: git clean -Fd (uppercase)', !!matchDestructive('git clean -Fd'));
ok('destructive: git push origin +main (refspec force)', !!matchDestructive('git push origin +main'));
// --- safe -c usages must NOT false-positive ---
ok('safe: git -c user.name=x commit', !matchDestructive('git -c user.name=x commit -m "msg"') && !matchBlocked('git -c user.name=x commit -m "msg"'));
ok('safe: bash -c "echo hello"', !matchDestructive('bash -c "echo hello"') && !matchBlocked('bash -c "echo hello"'));

// --- SAFE commands must NOT be flagged (false-positive guards) ---
ok('safe: git status', !matchDestructive('git status') && !matchBlocked('git status'));
ok('safe: git commit (msg mentioning reset --hard is stripped)', !matchDestructive('git commit -m "explain why we avoid reset --hard"'));
ok('safe: git reset HEAD~1 (soft/mixed, not --hard)', !matchDestructive('git reset HEAD~1'));
ok('safe: rm -f single file (not recursive)', !matchDestructive('rm -f /tmp/probe.txt'));
ok('safe: git push --force-with-lease NOT blocked (the recommended alt)', !matchDestructive('git push --force-with-lease origin feature') && !matchBlocked('git push --force-with-lease origin feature'));
ok('safe: npm test', !matchDestructive('npm test') && !matchBlocked('npm test'));
ok('safe: git clean -n (dry run, no -f)', !matchDestructive('git clean -n'));

// --- FRW-BL-090: WRITING a forbidden command is not RUNNING one ----------------------------
// The guard matched forbidden literals anywhere in the command string. A heredoc body is not a
// quoted string, so stripQuotes left it intact and a document that merely described the
// nested-session CLI flag as prose was blocked. Observed live (journal 234): cost one blocked
// call, routed around via the Write tool.
console.log('\n  FRW-BL-090 — non-command context');

const heredocDoc = [
  "cat <<'EOF' > docs/rules.md",
  '## Delegation',
  'Never use claude -p in a nested session: it hangs indefinitely.',
  'Also do not run git add -A; stage specific paths instead.',
  'EOF',
].join('\n');
ok('allows a heredoc that DOCUMENTS claude -p', !matchBlocked(heredocDoc));
ok('allows a heredoc that DOCUMENTS git add -A', !matchBlocked(heredocDoc.replace('claude -p', 'nothing')));

const heredocUnquoted = ['cat <<EOF', 'claude -p is forbidden', 'EOF'].join('\n');
ok('allows an UNQUOTED heredoc delimiter form', !matchBlocked(heredocUnquoted));

const heredocIndented = ['cat <<-EOF', '\tclaude -p is forbidden', '\tEOF'].join('\n');
ok('allows the <<- indented-delimiter form', !matchBlocked(heredocIndented));

ok('comment mentioning claude -p is allowed', !matchBlocked('npm test # never use claude -p here'));
ok('quoted mention still allowed (pre-existing behaviour intact)', !matchBlocked('echo "claude -p is banned"'));

// Command position and separators must STILL block — the fix must not become an escape hatch.
ok('BLOCKS claude -p in command position', !!matchBlocked('claude -p "do thing"'));
ok('BLOCKS claude -p after &&', !!matchBlocked('npm test && claude -p "go"'));
ok('BLOCKS claude -p after ;', !!matchBlocked('echo hi; claude -p "go"'));
ok('BLOCKS claude -p after a pipe', !!matchBlocked('cat x | claude -p'));
ok('BLOCKS a real command on the line that OPENS a heredoc',
  !!matchBlocked("claude -p 'x' <<'EOF'\nbody\nEOF"));
ok('BLOCKS a real command AFTER the heredoc terminator',
  !!matchBlocked("cat <<'EOF' > f.md\nprose\nEOF\nclaude -p 'go'"));
ok('destructive guard still fires outside a heredoc', !!matchDestructive("cat <<'EOF' > f.md\nprose\nEOF\ngit reset --hard"));
ok('destructive guard does NOT fire inside a heredoc body', !matchDestructive("cat <<'EOF' > f.md\nrun git reset --hard to undo\nEOF"));

// Fail closed: an unterminated heredoc has an unknowable extent, so matching must continue
// inside it rather than let an unclosed body become a bypass.
ok('FAIL CLOSED: unterminated heredoc still blocks claude -p',
  !!matchBlocked("cat <<'EOF' > f.md\nsome prose\nclaude -p 'go'"));
ok('FAIL CLOSED: unterminated heredoc still blocks rm -rf /',
  !!matchBlocked("cat <<'EOF' > f.md\nrm -rf /"));

// A here-STRING is not a heredoc — must not be treated as one.
ok('here-string <<< is not mistaken for a heredoc', !!matchBlocked('claude -p <<< "input"'));

// -c bypass closure must survive the new stripping order.
ok('bypass still closed: bash -c "rm -rf /" after heredoc handling', !!matchBlocked('bash -c "rm -rf /"'));

// Counter-proof: the PRE-FIX matcher (quote-stripping only) DID block the documentation heredoc.
// Without this, the tests above would merely restate the fix rather than catch its regression.
{
  const preFixStripQuotes = (c) => (c || '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const preFixMatchBlocked = (c) => BLOCKED_PATTERNS.some(({ pattern }) => pattern.test(preFixStripQuotes(c)));
  ok('PRE-FIX matcher DOES block the documentation heredoc (regression is caught)',
    preFixMatchBlocked(heredocDoc));
  ok('PRE-FIX matcher DOES block the comment mention (regression is caught)',
    preFixMatchBlocked('npm test # never use claude -p here'));
  ok('PRE-FIX matcher also blocked command position (so the fix preserved real blocking)',
    preFixMatchBlocked('claude -p "do thing"'));
}

// --- FRW-BL-092 (residual gap): the pattern set was POSIX-shaped ---------------------------
// Registering the hook for the PowerShell tool fixed the git tier there for free (git spells the
// same in every shell) but left the FILESYSTEM tier dead: PowerShell's `rm` alias rejects the
// bundled `-rf`, so `rm -rf` is unreachable prose there, while `Remove-Item -Recurse -Force` —
// the form a PowerShell caller actually writes — matched nothing. Confirmed by probe: a nested
// canary tree under TEMP was deleted unguarded through the PowerShell tool.
console.log('\n  FRW-BL-092 — PowerShell/cmd-native destructive verbs');

ok('destructive: Remove-Item -Recurse -Force', !!matchDestructive('Remove-Item -Recurse -Force C:\\tmp\\x'));
ok('destructive: Remove-Item -Force -Recurse (flag order swapped)', !!matchDestructive('Remove-Item -Force -Recurse C:\\tmp\\x'));
ok('destructive: Remove-Item -Recurse alone (deletes trees non-interactively)', !!matchDestructive('Remove-Item -Recurse C:\\tmp\\x'));
ok('destructive: abbreviated -Rec', !!matchDestructive('Remove-Item -Rec C:\\tmp\\x'));
ok('destructive: the literal probe command that ran UNGUARDED',
  !!matchDestructive('Remove-Item -Recurse -Force (Join-Path $env:TEMP "vldr-gap-probe-092")'));
ok('destructive: cmd rd /s', !!matchDestructive('rd /s /q C:\\tmp\\x'));
ok('destructive: cmd del /s', !!matchDestructive('del /s /q C:\\tmp\\*'));
ok('destructive: pipeline Get-ChildItem -Recurse | Remove-Item',
  !!matchDestructive('Get-ChildItem C:\\tmp -Recurse | Remove-Item -Force'));
ok('destructive: Clear-Content (in-place truncation)', !!matchDestructive('Clear-Content notes.md'));
ok('blocks Format-Volume (no escape hatch)', !!matchBlocked('Format-Volume -DriveLetter D'));
ok('blocks Clear-Disk (no escape hatch)', !!matchBlocked('Clear-Disk -Number 1 -RemoveData'));

// False-positive guards — symmetry with the POSIX tier, where `rm -f` on one file is allowed.
ok('safe: Remove-Item on a single file (no recurse)', !matchDestructive('Remove-Item C:\\tmp\\probe.txt'));
ok('safe: Remove-Item -Force on a single file', !matchDestructive('Remove-Item -Force C:\\tmp\\probe.txt'));
ok('safe: Get-ChildItem -Recurse with no deleting verb', !matchDestructive('Get-ChildItem . -Recurse'));
ok('safe: Get-ChildItem -Recurse | Measure-Object', !matchDestructive('Get-ChildItem . -Recurse | Measure-Object'));
ok('safe: dir /s (read-only listing)', !matchDestructive('dir /s C:\\tmp'));
ok('safe: git rm -r --cached (staging, not a filesystem wipe)', !matchDestructive('git rm -r --cached path'));
ok('safe: quoted prose about Remove-Item -Recurse', !matchDestructive('git commit -m "avoid Remove-Item -Recurse -Force here"'));
ok('safe: Get-Content (read) is not Clear-Content', !matchDestructive('Get-Content notes.md'));

// Counter-proof: the PRE-FIX pattern set did NOT match any PowerShell-native form. Without this,
// the assertions above would restate the fix instead of catching its regression.
{
  const preFixDestructive = DESTRUCTIVE_PATTERNS.filter(d => !/Remove-Item|Get-Child|Clear-Content/.test(String(d.pattern)));
  const preFixBlocked = BLOCKED_PATTERNS.filter(b => !/Format-Volume|Clear-Disk/.test(String(b.pattern)));
  const hit = (list, c) => list.some(({ pattern }) => pattern.test(stripQuotes(c)));
  ok('PRE-FIX set does NOT catch Remove-Item -Recurse -Force (regression is caught)',
    !hit(preFixDestructive, 'Remove-Item -Recurse -Force C:\\tmp\\x'));
  ok('PRE-FIX set does NOT catch rd /s (regression is caught)',
    !hit(preFixDestructive, 'rd /s /q C:\\tmp\\x'));
  ok('PRE-FIX set does NOT catch Format-Volume (regression is caught)',
    !hit(preFixBlocked, 'Format-Volume -DriveLetter D'));
  ok('PRE-FIX set DID already catch git filter-branch (shell-agnostic tier was never broken)',
    hit(preFixDestructive, 'git filter-branch --tree-filter x HEAD'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
