// config-change.js - ConfigChange hook (GUARDRAIL)
// Fires when Claude Code detects a live edit to settings/config during a session
// (settings.json, hook scripts, etc.). Volundr uses it to AUDIT mid-session
// mutations to its control surface — .claude/settings.json and .claude/hooks/* —
// so an unexpected config drift is visible in the dashboard events feed.
//
// Claude Code feature reference: ConfigChange hook event (CHANGELOG ~L2335,
// current official line — see framework/cc-version-baseline.md). The exact stdin
// shape for this event is NOT pinned by an authoritative schema in this repo, so
// this hook is modelled DEFENSIVELY: it reads whatever fields stdin provides and
// never assumes any single field exists (defensive degrade is an explicit ISC,
// not a fallback). Common candidate fields are probed in priority order below.
//
// Contract: command-type, guarded behind `if (require.main === module)`, and
// degrades GRACEFULLY (exit 0) on ANY error — a guardrail hook must never break
// the session.

const { readStdin, apiPost, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const path = require('path');
const log = createLogger('config-change');

// Path fragments that mean "this change touched Volundr's control surface".
// Matched case-insensitively against any path-like string we can extract from stdin.
const WATCHED_FRAGMENTS = [
  ['.claude', 'settings.json'],   // .claude/settings.json (the hook registry + env)
  ['.claude', 'hooks'],           // .claude/hooks/* (any hook script)
];

function normalizeSep(s) {
  return String(s).replace(/\\/g, '/');
}

// Pull every plausible path string out of an unknown-shape ConfigChange payload.
// We DO NOT assume any field name — we probe known candidates AND walk the object
// shallowly for string values that look like file paths. Bounded + non-throwing.
function extractPaths(input) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.trim()) out.add(v.trim());
    else if (Array.isArray(v)) v.forEach(add);
  };

  if (!input || typeof input !== 'object') return [];

  // Priority candidate fields seen across CC hook payloads (probe defensively).
  add(input.path);
  add(input.file_path);
  add(input.filePath);
  add(input.file);
  add(input.config_path);
  add(input.configPath);
  add(input.changed_path);
  add(input.changedPath);
  add(input.paths);
  add(input.changed_paths);
  add(input.changedPaths);
  add(input.files);
  if (input.config && typeof input.config === 'object') {
    add(input.config.path);
    add(input.config.file_path);
  }
  if (input.tool_input && typeof input.tool_input === 'object') {
    add(input.tool_input.file_path);
    add(input.tool_input.path);
  }

  // Shallow sweep: any top-level string value that looks like a path fragment.
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && /[\\/]/.test(v) && (v.includes('.claude') || v.endsWith('.json') || v.endsWith('.js'))) {
      out.add(v.trim());
    }
  }

  return [...out];
}

function matchesWatched(p) {
  const norm = normalizeSep(p).toLowerCase();
  return WATCHED_FRAGMENTS.some(frags => frags.every(f => norm.includes(f.toLowerCase())));
}

async function main() {
  const input = readStdin();

  const paths = extractPaths(input);
  // Keep only the changes that touch Volundr's control surface.
  const watched = paths.filter(matchesWatched);

  if (watched.length === 0) {
    // Either the change was unrelated, or stdin gave us nothing parseable.
    // Defensive degrade: if we extracted NO paths at all but the event fired,
    // still leave a low-noise breadcrumb so a totally-unknown payload shape is
    // visible during a restart-verification (does not warn, does not block).
    if (paths.length === 0) {
      log.debug('config_change_unparsed', 'ConfigChange fired with no extractable path (unknown payload shape)');
    } else {
      log.debug('config_change_untracked', `ConfigChange touched ${paths.length} non-control-surface path(s)`);
    }
    return;
  }

  // Name exactly what changed (basenames + tag whether it's settings vs a hook).
  const named = watched.map(p => {
    const norm = normalizeSep(p);
    const base = path.posix.basename(norm);
    const isSettings = norm.toLowerCase().includes('.claude/settings.json');
    return isSettings ? `settings.json` : `hooks/${base}`;
  });
  const unique = [...new Set(named)];
  const detail = `config-change: live edit to ${unique.join(', ')}`;

  log.warn('config_change', detail, {});
  // Audit it on the dashboard events feed so config drift is observable.
  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'intervention',
    detail,
  });
}

if (require.main === module) {
  main().catch((e) => {
    // GRACEFUL DEGRADE: never break the session on a guardrail-hook failure.
    try { log.error('unhandled_error', e.message, { error: e.stack }); } catch { /* ignore */ }
    process.exit(0);
  });
}

module.exports = { extractPaths, matchesWatched };
