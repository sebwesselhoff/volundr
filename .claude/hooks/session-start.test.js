// Self-test for session-start.js: the boot sweeps must not delete the CURRENT session's artifacts.
//
// Regression guard for FRW-BL-089. Two sweeps in this hook deleted state belonging to the session
// they were booting:
//
//   A) ~/.claude/teams/ — every directory except 'default' was removed recursively. Claude Code
//      initialises this session's own team directory (session-<truncated-id>) at startup, in the
//      same window the hook runs, so the sweep raced and destroyed it. Every named/addressable
//      Agent call then failed for the rest of the session with
//        Internal error: team file for "session-<id>" not found
//      Observed live in session 244933cb: name+background FAILED, name+foreground FAILED,
//      unnamed+foreground SUCCEEDED — isolating `name` as the discriminator. Because the named
//      path is the Agent Teams teammate path, ALL teammate delegation silently disappeared.
//
//   B) os.tmpdir()/mc-agent-map — every file was unlinked, including the `current-session` file
//      the same hook had written seconds earlier. Boot Step 6 documents reading that file to write
//      the session-<id> -> dashboard-id parent-attribution fallback map (FRW-BL-029/068), so that
//      read could never succeed on a startup boot.
//
// These tests drive the real sweep functions against real temp directories, so they assert
// BEHAVIOUR, not the shape of the source. Each also runs the PRE-FIX algorithm over identical
// fixtures and asserts it destroys what the fixed one preserves — without that, the test would
// merely restate the fix rather than catch its regression.
//
// Run: node session-start.test.js  — exits 0 on success, 1 on any failure.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isCurrentSessionTeamDir,
  cleanupTeamDirs,
  cleanupAgentMaps,
} = require('./session-start.js');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

// --- fixtures -------------------------------------------------------------

const SESSION_ID = '244933cb-b4fb-4190-9caf-704f58759797';
const CURRENT_TEAM = 'session-244933cb'; // the truncated form Claude Code actually uses
const STALE_TEAM = 'session-0badbeef';

const roots = [];
function tmpRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vldr-sstest-${tag}-`));
  roots.push(dir);
  return dir;
}

// Build a teams dir containing: the current session's team, a stale team, and 'default'.
// `staleAgeMs` backdates the stale team so it falls outside the mtime grace window.
function makeTeamsDir(staleAgeMs = 10 * 60 * 1000) {
  const teamsDir = tmpRoot('teams');
  for (const name of [CURRENT_TEAM, STALE_TEAM, 'default']) {
    const d = path.join(teamsDir, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'team.json'), JSON.stringify({ name }));
  }
  const old = new Date(Date.now() - staleAgeMs);
  fs.utimesSync(path.join(teamsDir, STALE_TEAM), old, old);
  return teamsDir;
}

// The PRE-FIX team sweep, verbatim in behaviour: delete everything except 'default'.
function preFixTeamSweep(teamsDir) {
  const removed = [];
  for (const dirName of fs.readdirSync(teamsDir).filter(d => d !== 'default')) {
    const teamPath = path.join(teamsDir, dirName);
    const removeDir = (dir) => {
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (fs.statSync(p).isDirectory()) removeDir(p);
        else fs.unlinkSync(p);
      }
      fs.rmdirSync(dir);
    };
    removeDir(teamPath);
    removed.push(dirName);
  }
  return removed;
}

// --- A: team directory sweep ---------------------------------------------

console.log('session-start.js — boot sweeps preserve the current session (FRW-BL-089)');

ok('current session team dir matches by exact id', isCurrentSessionTeamDir(`session-${SESSION_ID}`, SESSION_ID));
ok('current session team dir matches by TRUNCATED id', isCurrentSessionTeamDir(CURRENT_TEAM, SESSION_ID));
ok('an unrelated session team dir does not match', !isCurrentSessionTeamDir(STALE_TEAM, SESSION_ID));
ok('a non-session directory does not match', !isCurrentSessionTeamDir('default', SESSION_ID));
ok('nothing matches when session id is unknown', !isCurrentSessionTeamDir(CURRENT_TEAM, null));

{
  const teamsDir = makeTeamsDir();
  const res = cleanupTeamDirs(teamsDir, { sessionId: SESSION_ID });

  ok(
    "this session's team directory SURVIVES the sweep",
    fs.existsSync(path.join(teamsDir, CURRENT_TEAM)),
    `skipped=${JSON.stringify(res.skipped)} cleaned=${JSON.stringify(res.cleaned)}`
  );
  ok(
    "this session's team FILE survives (not just the directory)",
    fs.existsSync(path.join(teamsDir, CURRENT_TEAM, 'team.json'))
  );
  ok(
    'a genuinely stale team directory is still cleaned (crash recovery preserved)',
    !fs.existsSync(path.join(teamsDir, STALE_TEAM)),
    `cleaned=${JSON.stringify(res.cleaned)}`
  );
  ok(
    "Claude Code's 'default' directory is never touched",
    fs.existsSync(path.join(teamsDir, 'default'))
  );
  ok(
    'the preserved dir is reported with reason current-session',
    res.skipped.some(s => s.dirName === CURRENT_TEAM && s.reason === 'current-session'),
    JSON.stringify(res.skipped)
  );
}

{
  // Counter-proof: the PRE-FIX sweep destroys exactly what the fixed sweep preserves.
  const teamsDir = makeTeamsDir();
  const removed = preFixTeamSweep(teamsDir);
  ok(
    "PRE-FIX sweep DOES delete this session's team dir (proves the test catches the regression)",
    !fs.existsSync(path.join(teamsDir, CURRENT_TEAM)) && removed.includes(CURRENT_TEAM),
    `removed=${JSON.stringify(removed)}`
  );
}

{
  // Secondary guard: with no session id available, a recently-active dir is still spared.
  const teamsDir = makeTeamsDir();
  const res = cleanupTeamDirs(teamsDir, { sessionId: null });
  ok(
    'with no session id, a freshly-created team dir is spared by the mtime guard',
    fs.existsSync(path.join(teamsDir, CURRENT_TEAM)),
    JSON.stringify(res)
  );
  ok(
    'with no session id, an old team dir is still cleaned',
    !fs.existsSync(path.join(teamsDir, STALE_TEAM)),
    JSON.stringify(res)
  );
}

{
  // The mtime guard must not become an excuse to never clean anything.
  const teamsDir = makeTeamsDir();
  const res = cleanupTeamDirs(teamsDir, { sessionId: SESSION_ID, graceMs: 0 });
  ok(
    'with the grace window disabled, the current session is STILL protected by name',
    fs.existsSync(path.join(teamsDir, CURRENT_TEAM)),
    JSON.stringify(res)
  );
}

ok('a missing teams directory is not an error', (() => {
  const res = cleanupTeamDirs(path.join(tmpRoot('empty'), 'does-not-exist'), { sessionId: SESSION_ID });
  return res.cleaned.length === 0 && res.skipped.length === 0;
})());

// --- B: agent-map sweep ---------------------------------------------------

{
  const mapDir = tmpRoot('maps');
  fs.writeFileSync(path.join(mapDir, 'current-session'), SESSION_ID);
  fs.writeFileSync(path.join(mapDir, 'volundr-lead'), 'some-agent-id');
  fs.writeFileSync(path.join(mapDir, 'a0f4aa22795d7dff5'), 'stale-agent-id');

  const res = cleanupAgentMaps(mapDir);

  ok(
    'the current-session file SURVIVES the map sweep',
    fs.existsSync(path.join(mapDir, 'current-session')),
    JSON.stringify(res)
  );
  ok(
    'its contents are intact (the session id is still readable)',
    fs.readFileSync(path.join(mapDir, 'current-session'), 'utf8') === SESSION_ID
  );
  ok(
    'stale agent mappings are still cleaned',
    !fs.existsSync(path.join(mapDir, 'a0f4aa22795d7dff5'))
      && !fs.existsSync(path.join(mapDir, 'volundr-lead')),
    JSON.stringify(res)
  );
}

{
  // Counter-proof for surface B: the PRE-FIX map sweep deleted everything, including the file
  // Boot Step 6 depends on.
  const mapDir = tmpRoot('maps-prefix');
  fs.writeFileSync(path.join(mapDir, 'current-session'), SESSION_ID);
  fs.writeFileSync(path.join(mapDir, 'volundr-lead'), 'some-agent-id');
  for (const f of fs.readdirSync(mapDir)) fs.unlinkSync(path.join(mapDir, f)); // pre-fix behaviour
  ok(
    'PRE-FIX map sweep DOES delete current-session (proves the test catches the regression)',
    !fs.existsSync(path.join(mapDir, 'current-session'))
  );
}

// --- ordering invariant ---------------------------------------------------
// Even with the preserve-list, the write must come AFTER the sweep: if a future edit reorders
// them and drops the preserve entry, the bug returns. Assert the source ordering too.
{
  const src = fs.readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
  const sweepIdx = src.indexOf('cleanupAgentMaps(mapDir)');
  const writeIdx = src.indexOf("writeFileSync(path.join(mapDir, 'current-session')");
  ok('map sweep call is present', sweepIdx !== -1);
  ok('current-session write is present', writeIdx !== -1);
  ok(
    'current-session is written AFTER the map sweep runs',
    sweepIdx !== -1 && writeIdx !== -1 && writeIdx > sweepIdx,
    `sweep@${sweepIdx} write@${writeIdx}`
  );
}

// --- cleanup --------------------------------------------------------------

for (const r of roots) {
  try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
