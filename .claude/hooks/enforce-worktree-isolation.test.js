// Self-test for enforce-worktree-isolation.js (FRW-BL-039).
// Run: node enforce-worktree-isolation.test.js — exits 0 on success, 1 on failure.
'use strict';

const { isInWorktree } = require('./enforce-worktree-isolation.js');

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
  }
}

console.log('enforce-worktree-isolation self-test\n');

// ---- PRIMARY path: workspace.git_worktree field present ----

// Truthy git_worktree → in worktree (allowed)
ok('native field truthy (true) → in-worktree',
  isInWorktree({ workspace: { git_worktree: true } }, '/home/user/project'));

ok('native field truthy (string path) → in-worktree',
  isInWorktree({ workspace: { git_worktree: '/path/to/wt' } }, '/home/user/project'));

// Falsy git_worktree → NOT in worktree (would be blocked)
ok('native field falsy (false) → NOT in-worktree',
  !isInWorktree({ workspace: { git_worktree: false } }, '/home/user/project'));

ok('native field falsy (null) → NOT in-worktree',
  !isInWorktree({ workspace: { git_worktree: null } }, '/home/user/project'));

ok('native field falsy (empty string) → NOT in-worktree',
  !isInWorktree({ workspace: { git_worktree: '' } }, '/home/user/project'));

// ---- FALLBACK path: workspace field ABSENT → fall back to cwd substring ----

// No workspace key at all → fallback
ok('fallback: no workspace key, worktrees cwd (forward slash) → in-worktree',
  isInWorktree({}, '/home/user/project/.claude/worktrees/agent-card-001'));

ok('fallback: no workspace key, worktrees cwd (backslash) → in-worktree',
  isInWorktree({}, 'C:\\Users\\user\\project\\.claude\\worktrees\\agent-card-001'));

ok('fallback: no workspace key, main checkout cwd → NOT in-worktree',
  !isInWorktree({}, '/home/user/project'));

ok('fallback: no workspace key, main checkout cwd (Windows) → NOT in-worktree',
  !isInWorktree({}, 'C:\\Users\\user\\project'));

// Null input → fallback
ok('fallback: null input, worktrees cwd → in-worktree',
  isInWorktree(null, '/some/.claude/worktrees/branch'));

ok('fallback: null input, main checkout cwd → NOT in-worktree',
  !isInWorktree(null, '/home/user/project'));

// workspace key present but git_worktree undefined → fallback to cwd
ok('fallback: workspace present but git_worktree key absent, worktrees cwd → in-worktree',
  isInWorktree({ workspace: {} }, '/home/user/project/.claude/worktrees/agent-abc'));

ok('fallback: workspace present but git_worktree key absent, main cwd → NOT in-worktree',
  !isInWorktree({ workspace: {} }, '/home/user/project'));

// Edge: workspace is null → fallback
ok('fallback: workspace is null, worktrees cwd → in-worktree',
  isInWorktree({ workspace: null }, '/home/user/.claude/worktrees/card'));

ok('fallback: workspace is null, main cwd → NOT in-worktree',
  !isInWorktree({ workspace: null }, '/home/user/project'));

// ---- Summary ----
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
