// Self-test for workspace-index.mjs (FRW-BL-065). Run: node scripts/workspace-index.test.mjs
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  slugifyTopic,
  workspaceDir,
  topicFile,
  writeFinding,
  readFindings,
  readIndex,
  updateIndex,
  shouldExternalize,
  WORKSPACE_DIRNAME,
  EXTERNALIZE_THRESHOLD,
} from './workspace-index.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('workspace-index self-test\n');

// --- slugifyTopic: deterministic + filesystem-safe ---
ok('slugify deterministic', slugifyTopic('Auth Token Refresh') === slugifyTopic('Auth Token Refresh'));
ok('slugify lowercases + hyphenates', slugifyTopic('Auth Token Refresh') === 'auth-token-refresh');
ok('slugify strips unsafe chars', slugifyTopic('a/b\\c:*?"<>|.md') === 'a-b-c-md');
ok('slugify collapses + trims hyphens', slugifyTopic('  --Foo   Bar!!  ') === 'foo-bar');
ok('slugify empty -> untitled', slugifyTopic('') === 'untitled' && slugifyTopic('***') === 'untitled');
ok('slugify null-safe', slugifyTopic(null) === 'untitled' && slugifyTopic(undefined) === 'untitled');

// --- workspaceDir convention ---
ok('workspaceDir uses .vldr-workspace', workspaceDir('/proj').endsWith(WORKSPACE_DIRNAME) && WORKSPACE_DIRNAME === '.vldr-workspace');

// --- topicFile: deterministic ---
{
  const ws = workspaceDir('/proj');
  ok('topicFile deterministic', topicFile(ws, 'My Topic') === topicFile(ws, 'My Topic'));
  ok('topicFile is <slug>.md', topicFile(ws, 'My Topic').endsWith(`${join('', 'my-topic.md')}`));
}

// --- shouldExternalize boundary (threshold-1 false, threshold+1 true) ---
ok('default threshold is 1500', EXTERNALIZE_THRESHOLD === 1500);
ok('shouldExternalize threshold-1 = false', shouldExternalize('x'.repeat(EXTERNALIZE_THRESHOLD - 1)) === false);
ok('shouldExternalize exactly threshold = false', shouldExternalize('x'.repeat(EXTERNALIZE_THRESHOLD)) === false);
ok('shouldExternalize threshold+1 = true', shouldExternalize('x'.repeat(EXTERNALIZE_THRESHOLD + 1)) === true);
ok('shouldExternalize custom threshold', shouldExternalize('abcdef', 5) === true && shouldExternalize('abcde', 5) === false);
ok('shouldExternalize null-safe', shouldExternalize(null) === false);

// --- I/O round-trip in a temp dir (cleaned up with fs.rmSync) ---
const tmpRoot = mkdtempSync(join(tmpdir(), 'vldr-ws-'));
try {
  const ws = workspaceDir(tmpRoot);

  // readFindings on missing topic -> ''
  ok('readFindings missing topic -> empty', readFindings(ws, 'nope') === '');
  // readIndex missing -> {}
  ok('readIndex missing -> {}', Object.keys(readIndex(ws)).length === 0);

  // writeFinding creates dir + file, round-trips content
  const f1 = writeFinding(ws, 'Auth Refresh', 'JWT refresh races on concurrent calls');
  ok('writeFinding creates workspace dir', existsSync(ws));
  ok('writeFinding returns existing file path', existsSync(f1) && f1 === topicFile(ws, 'Auth Refresh'));
  ok('readFindings round-trips first finding', readFindings(ws, 'Auth Refresh').includes('JWT refresh races on concurrent calls'));

  // append second finding to same topic
  writeFinding(ws, 'Auth Refresh', 'second finding body');
  const body = readFindings(ws, 'Auth Refresh');
  ok('readFindings contains both findings', body.includes('JWT refresh races on concurrent calls') && body.includes('second finding body'));

  // index reflects topic + count
  const idx = readIndex(ws);
  ok('index has the topic slug', Object.prototype.hasOwnProperty.call(idx, 'auth-refresh'));
  ok('index count incremented per write', idx['auth-refresh'].count === 2);
  ok('index points at <slug>.md', idx['auth-refresh'].file === 'auth-refresh.md');
  ok('index preserves original topic label', idx['auth-refresh'].topic === 'Auth Refresh');

  // a second distinct topic appears independently in the index
  writeFinding(ws, 'DB Migrations', 'migration 003 is not idempotent');
  const idx2 = readIndex(ws);
  ok('index tracks multiple topics', Object.keys(idx2).length === 2 && 'db-migrations' in idx2);

  // updateIndex callable directly (count bump without a write)
  updateIndex(ws, 'Auth Refresh', topicFile(ws, 'Auth Refresh'));
  ok('updateIndex bumps count directly', readIndex(ws)['auth-refresh'].count === 3);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
ok('temp dir cleaned up', !existsSync(tmpRoot));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
