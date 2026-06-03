// Self-test for workspace-index.mjs (FRW-BL-065). Run: node scripts/workspace-index.test.mjs
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  slugifyTopic,
  topicKey,
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

// --- topicKey: collision-safe (slug + hash6) ---
ok('topicKey deterministic', topicKey('Auth Refresh') === topicKey('Auth Refresh'));
ok('topicKey includes slug prefix', topicKey('Auth Refresh').startsWith('auth-refresh-'));
ok('topicKey appends 6-hex hash', /^[a-z0-9-]+-[0-9a-f]{6}$/.test(topicKey('Auth Refresh')));
// Two topics that slugify identically must produce DIFFERENT keys (collision fix)
ok('topicKey: "API: v1" vs "api v1" → different keys', topicKey('API: v1') !== topicKey('api v1'));
ok('topicKey: "auth-token" vs "auth token" → different keys', topicKey('auth-token') !== topicKey('auth token'));
ok('topicKey null-safe', topicKey(null) === topicKey(null) && topicKey(null).startsWith('untitled-'));

// --- workspaceDir convention ---
ok('workspaceDir uses .vldr-workspace', workspaceDir('/proj').endsWith(WORKSPACE_DIRNAME) && WORKSPACE_DIRNAME === '.vldr-workspace');

// --- topicFile: deterministic + collision-safe ---
{
  const ws = workspaceDir('/proj');
  ok('topicFile deterministic', topicFile(ws, 'My Topic') === topicFile(ws, 'My Topic'));
  ok('topicFile uses <slug>-<hash6>.md pattern', /[a-z0-9-]+-[0-9a-f]{6}\.md$/.test(topicFile(ws, 'My Topic')));
  // Collision regression: two topics sharing a base slug → different files
  const f1 = topicFile(ws, 'API: v1');
  const f2 = topicFile(ws, 'api v1');
  ok('topicFile: collision-distinct topics → different files', f1 !== f2);
  ok('topicFile: "API: v1" filename matches topicKey', f1.endsWith(`${topicKey('API: v1')}.md`));
  ok('topicFile: "api v1" filename matches topicKey', f2.endsWith(`${topicKey('api v1')}.md`));
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
  ok('writeFinding returns collision-safe file path', existsSync(f1) && f1 === topicFile(ws, 'Auth Refresh'));
  ok('readFindings round-trips first finding', readFindings(ws, 'Auth Refresh').includes('JWT refresh races on concurrent calls'));

  // append second finding to same topic
  writeFinding(ws, 'Auth Refresh', 'second finding body');
  const body = readFindings(ws, 'Auth Refresh');
  ok('readFindings contains both findings', body.includes('JWT refresh races on concurrent calls') && body.includes('second finding body'));

  // index reflects topic + count — key is now topicKey, not bare slug
  const idx = readIndex(ws);
  const authKey = topicKey('Auth Refresh');
  ok('index has the collision-safe topic key', Object.prototype.hasOwnProperty.call(idx, authKey));
  ok('index count incremented per write', idx[authKey].count === 2);
  ok('index points at <slug>-<hash6>.md', idx[authKey].file === `${authKey}.md`);
  ok('index preserves original topic label', idx[authKey].topic === 'Auth Refresh');

  // a second distinct topic appears independently in the index
  writeFinding(ws, 'DB Migrations', 'migration 003 is not idempotent');
  const idx2 = readIndex(ws);
  const dbKey = topicKey('DB Migrations');
  ok('index tracks multiple topics', Object.keys(idx2).length === 2 && dbKey in idx2);

  // updateIndex callable directly (count bump, no file arg)
  updateIndex(ws, 'Auth Refresh');
  ok('updateIndex bumps count directly', readIndex(ws)[authKey].count === 3);

  // --- COLLISION REGRESSION TEST ---
  // "auth-token" and "auth token" both slugify to "auth-token" but are distinct topics.
  // They must write to separate files and remain independently readable.
  const fA = writeFinding(ws, 'auth-token', 'finding from auth-token topic');
  const fB = writeFinding(ws, 'auth token', 'finding from auth token topic');
  ok('collision regression: distinct files written', fA !== fB);
  ok('collision regression: "auth-token" finding isolated', readFindings(ws, 'auth-token').includes('finding from auth-token topic'));
  ok('collision regression: "auth token" finding isolated', readFindings(ws, 'auth token').includes('finding from auth token topic'));
  ok('collision regression: "auth-token" does NOT contain "auth token" finding', !readFindings(ws, 'auth-token').includes('finding from auth token topic'));
  ok('collision regression: "auth token" does NOT contain "auth-token" finding', !readFindings(ws, 'auth token').includes('finding from auth-token topic'));
  const idxC = readIndex(ws);
  const keyA = topicKey('auth-token');
  const keyB = topicKey('auth token');
  ok('collision regression: both appear in index with separate keys', keyA in idxC && keyB in idxC && keyA !== keyB);
  ok('collision regression: original topic labels preserved', idxC[keyA].topic === 'auth-token' && idxC[keyB].topic === 'auth token');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
ok('temp dir cleaned up', !existsSync(tmpRoot));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
