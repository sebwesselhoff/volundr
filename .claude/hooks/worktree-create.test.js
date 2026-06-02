// worktree-create.test.js — Self-test for the resolveCardIdFromQueue helper
// Run: node .claude/hooks/worktree-create.test.js
// No test framework dependency — uses Node.js built-in `assert`.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import the pure helpers we extracted from worktree-create.js
const { resolveCardIdFromQueue, classifyGitError, createWorktreeWithRetry } = require('./worktree-create');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// Helper: create a temp dir for each test case
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'));
}

// Helper: write a descriptor file into a dir with controllable mtime offset
function writeDescriptor(dir, filename, payload, mtimeOffsetMs = 0) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(payload));
  if (mtimeOffsetMs !== 0) {
    const now = Date.now();
    const t = (now + mtimeOffsetMs) / 1000;
    fs.utimesSync(filePath, t, t);
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// (a) No queue files — returns null
// ---------------------------------------------------------------------------
test('(a) empty queue dir returns null', () => {
  const dir = makeTempDir();
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, null, `Expected null for empty dir, got: ${result}`);
});

// ---------------------------------------------------------------------------
// (b) One matching descriptor — returns its cardId
// ---------------------------------------------------------------------------
test('(b) single descriptor with cardId returns that cardId', () => {
  const dir = makeTempDir();
  writeDescriptor(dir, 'developer-1746000000000-abc123', {
    description: 'Implement feature X',
    name: 'dev-agent',
    subagentType: 'developer',
    cardId: 'FRW-BL-014B',
    personaId: 'api-designer',
  });
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, 'FRW-BL-014B', `Expected FRW-BL-014B, got: ${result}`);
});

// ---------------------------------------------------------------------------
// (c) Descriptor without cardId — returns null
// ---------------------------------------------------------------------------
test('(c) descriptor without cardId returns null', () => {
  const dir = makeTempDir();
  writeDescriptor(dir, 'developer-1746000000000-xyz999', {
    description: 'Some task without a card',
    name: 'planner',
    subagentType: 'general-purpose',
    cardId: null,
    personaId: null,
  });
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, null, `Expected null when cardId is null, got: ${result}`);
});

// ---------------------------------------------------------------------------
// (d) Most-recent-wins: two files, newer one has cardId, older one does not
// ---------------------------------------------------------------------------
test('(d) most-recent-wins: newer file cardId returned over older no-cardId file', () => {
  const dir = makeTempDir();
  // Write older file first (negative offset makes mtime 2 seconds in the past)
  writeDescriptor(dir, 'developer-1746000001000-old111', {
    description: 'Old spawn without card',
    name: 'anon',
    subagentType: 'developer',
    cardId: null,
    personaId: null,
  }, -2000);
  // Write newer file
  writeDescriptor(dir, 'developer-1746000002000-new222', {
    description: 'New spawn with card',
    name: 'dev-new',
    subagentType: 'developer',
    cardId: 'CARD-FRW-007',
    personaId: null,
  }, 0);
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, 'CARD-FRW-007', `Expected CARD-FRW-007 from newest file, got: ${result}`);
});

// ---------------------------------------------------------------------------
// (e) Most-recent-wins: both have cardId, newest one wins
// ---------------------------------------------------------------------------
test('(e) most-recent-wins: when both files have cardId, newest cardId is returned', () => {
  const dir = makeTempDir();
  writeDescriptor(dir, 'developer-1746000001000-cardA', {
    description: 'Older spawn',
    name: 'dev-old',
    subagentType: 'developer',
    cardId: 'FRW-001',
    personaId: null,
  }, -3000);
  writeDescriptor(dir, 'developer-1746000002000-cardB', {
    description: 'Newer spawn',
    name: 'dev-new',
    subagentType: 'developer',
    cardId: 'FRW-002',
    personaId: null,
  }, 0);
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, 'FRW-002', `Expected FRW-002 (newest), got: ${result}`);
});

// ---------------------------------------------------------------------------
// (f) Corrupt file is skipped, valid next file is returned
// ---------------------------------------------------------------------------
test('(f) corrupt file is skipped, valid file still returns cardId', () => {
  const dir = makeTempDir();
  // Newer file is corrupt JSON
  const corruptPath = path.join(dir, 'developer-1746000003000-corrupt');
  fs.writeFileSync(corruptPath, '{ this is not valid json ');
  // Older file has valid descriptor with cardId
  writeDescriptor(dir, 'developer-1746000001000-valid', {
    description: 'Valid spawn',
    name: 'dev-valid',
    subagentType: 'developer',
    cardId: 'FRW-BL-014',
    personaId: null,
  }, -2000);
  const result = resolveCardIdFromQueue(dir);
  assert.strictEqual(result, 'FRW-BL-014', `Expected FRW-BL-014 after skipping corrupt file, got: ${result}`);
});

// ---------------------------------------------------------------------------
// (g) Non-existent dir — returns null (graceful degradation)
// ---------------------------------------------------------------------------
test('(g) non-existent queue dir returns null gracefully', () => {
  const nonExistent = path.join(os.tmpdir(), 'wc-test-nonexistent-' + Date.now());
  const result = resolveCardIdFromQueue(nonExistent);
  assert.strictEqual(result, null, `Expected null for non-existent dir, got: ${result}`);
});

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// FRW-BL-025 — classifyGitError unit cases
// ---------------------------------------------------------------------------
test('(h) classifyGitError: index.lock -> lock-contention', () => {
  assert.strictEqual(classifyGitError("fatal: Unable to create '/repo/.git/index.lock': File exists"), 'lock-contention');
});
test('(i) classifyGitError: cannot lock ref -> lock-contention', () => {
  assert.strictEqual(classifyGitError('fatal: cannot lock ref refs/heads/x: Unable to create lock file'), 'lock-contention');
});
test('(j) classifyGitError: already exists -> worktree-exists', () => {
  assert.strictEqual(classifyGitError("fatal: '/repo/.claude/worktrees/a' already exists"), 'worktree-exists');
});
test('(k) classifyGitError: arbitrary -> fatal', () => {
  assert.strictEqual(classifyGitError('fatal: not a git repository'), 'fatal');
});

// ---------------------------------------------------------------------------
// FRW-BL-025 — retry behaviour with an injected git impl (no real git needed)
// ---------------------------------------------------------------------------
async function testRetryBackoff() {
  await testAsync('(l) retries lock-contention then succeeds', async () => {
    let calls = 0;
    const gitWorktreeAdd = async () => {
      calls++;
      if (calls < 3) { const e = new Error("Unable to create index.lock: File exists"); throw e; }
    };
    const res = await createWorktreeWithRetry('worktree/x', path.join(makeTempDir(), 'wt'), '/fake',
      { gitWorktreeAdd, sleepImpl: async () => {}, baseDelayMs: 1 });
    assert.strictEqual(res.ok, true, `Expected ok after 3 attempts, got ${JSON.stringify(res)}`);
    assert.strictEqual(res.attempts, 3, `Expected 3 attempts, got ${res.attempts}`);
  });

  await testAsync('(m) fatal error fails fast without retry', async () => {
    let calls = 0;
    const gitWorktreeAdd = async () => { calls++; throw new Error('fatal: not a git repository'); };
    const res = await createWorktreeWithRetry('worktree/x', path.join(makeTempDir(), 'wt'), '/fake',
      { gitWorktreeAdd, sleepImpl: async () => {}, baseDelayMs: 1 });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.classification, 'fatal');
    assert.strictEqual(calls, 1, `Fatal should not retry; got ${calls} calls`);
  });

  await testAsync('(n) lock-contention exhausts maxAttempts then returns classified failure', async () => {
    const gitWorktreeAdd = async () => { throw new Error('cannot lock ref'); };
    const res = await createWorktreeWithRetry('worktree/x', path.join(makeTempDir(), 'wt'), '/fake',
      { gitWorktreeAdd, sleepImpl: async () => {}, baseDelayMs: 1, maxAttempts: 3 });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.classification, 'lock-contention');
    assert.strictEqual(res.attempts, 3);
  });
}

// ---------------------------------------------------------------------------
// FRW-BL-025 — REAL concurrent worktree creation against a temp git repo.
// Uses promisified execFile so the 4 adds are genuinely in-flight together and
// hit real index-lock contention; the retry must make all 4 succeed.
// ---------------------------------------------------------------------------
async function testConcurrentReal() {
  const { execFileSync, execFile } = require('child_process');
  const { promisify } = require('util');
  const pExecFile = promisify(execFile);

  let repo;
  try {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), '# tmp\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  } catch (e) {
    console.log('  SKIP  (o) 4 concurrent worktree creations — git unavailable: ' + e.message);
    return;
  }

  const gitWorktreeAdd = async (branch, worktreeDir, projectRoot) => {
    await pExecFile('git', ['worktree', 'add', '-b', branch, worktreeDir, 'HEAD'], { cwd: projectRoot });
  };

  await testAsync('(o) 4 concurrent worktree creations all succeed (no silent cancel)', async () => {
    const names = ['agent-a', 'agent-b', 'agent-c', 'agent-d'];
    const results = await Promise.all(names.map((n) =>
      createWorktreeWithRetry(`worktree/${n}`, path.join(repo, '.claude', 'worktrees', n), repo,
        { gitWorktreeAdd, baseDelayMs: 25, maxAttempts: 5 })
    ));
    const ok = results.filter((r) => r.ok).length;
    const classes = results.map((r) => r.classification || 'ok').join(',');
    assert.strictEqual(ok, 4, `Expected all 4 to succeed, got ${ok}/4 (classes: ${classes})`);
  });

  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repo });
    fs.rmSync(repo, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
}

// ---------------------------------------------------------------------------
// Async runner + summary
// ---------------------------------------------------------------------------
(async () => {
  await testRetryBackoff();
  await testConcurrentReal();
  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('PASS');
  }
})();
