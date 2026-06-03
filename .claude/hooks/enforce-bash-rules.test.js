// Self-test for enforce-bash-rules.js (FRW-BL-051 destructive-guard + existing blocks).
// Run: node enforce-bash-rules.test.js — exits 0 on success, 1 on failure.
const { matchBlocked, matchDestructive } = require('./enforce-bash-rules.js');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
