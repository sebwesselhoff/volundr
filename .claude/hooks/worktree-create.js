// WorktreeCreate hook - create worktree AND track in dashboard
// This hook IS the worktree creation mechanism - must output the path to stdout.
// Input: { name: "slug-name", session_id, agent_id?, agent_type?, ... }
// Output: absolute path to created worktree directory (one line to stdout)

const { apiGet, apiPost, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('worktree-create');

function getWorktreeMapDir() {
  const dir = path.join(os.tmpdir(), 'mc-agent-map', 'worktrees');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  return dir;
}

function getDescQueueDir() {
  return path.join(os.tmpdir(), 'mc-agent-map', 'desc-queue');
}

// Resolve the cardId for the spawn this hook is serving by peeking (not consuming)
// at the descriptor queue written by pre-agent-tool.js.
//
// Strategy: read all files in the queue dir, sort by mtime descending (most recent first),
// parse each as JSON, return the first truthy cardId found.
// This is a heuristic — the queue is short-lived per spawn so the most-recent descriptor
// is overwhelmingly likely to belong to this spawn. False positives are acceptable because
// the checkout call (steps 2-4) fails safe on every error path.
// We PEEK (do NOT delete) — agent-start.js will pop the file later.
//
// An optional dirOverride parameter lets the self-test inject a fake queue dir.
function resolveCardIdFromQueue(dirOverride) {
  const queueDir = dirOverride || getDescQueueDir();
  try {
    if (!fs.existsSync(queueDir)) return null;
    const entries = fs.readdirSync(queueDir);
    if (entries.length === 0) return null;

    // Build list with mtime so we can sort newest-first
    const withMtime = entries.map((f) => {
      try {
        const filePath = path.join(queueDir, f);
        const stat = fs.statSync(filePath);
        return { f, filePath, mtime: stat.mtimeMs };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Sort newest first
    withMtime.sort((a, b) => b.mtime - a.mtime);

    for (const { filePath } of withMtime) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data && data.cardId) return data.cardId;
      } catch (e) {
        // Corrupt or unreadable file — skip
      }
    }
  } catch (e) {
    // Queue dir unreadable — degrade silently
  }
  return null;
}

async function attemptCardCheckout(cardId) {
  // Look up the card to determine its current status
  const card = await apiGet(`/api/cards/${cardId}`);
  if (!card) {
    // Dashboard unreachable or card not found — degrade silently
    log.debug('card_lookup_failed', `Could not look up card ${cardId} — proceeding without checkout`);
    return;
  }

  if (card.error) {
    log.debug('card_lookup_error', `Card lookup returned error for ${cardId} — proceeding without checkout`);
    return;
  }

  if (card.status === 'in_progress' || card.status === 'done') {
    // Already claimed or completed — no-op, just proceed
    log.debug('card_already_claimed', `Card ${cardId} is ${card.status} — skipping checkout`);
    return;
  }

  if (card.status === 'backlog') {
    // Atomically claim it before the worktree is created
    const result = await apiPost(`/api/cards/${cardId}/checkout`, {});
    if (!result || result.error) {
      // Race condition (409) or transient failure — degrade silently, do not block worktree creation
      log.debug('checkout_failed', `Checkout of card ${cardId} returned null/error — proceeding anyway`);
      return;
    }
    log.info('card_checked_out', `Card ${cardId} transitioned to in_progress via checkout`);
    return;
  }

  // Any other status (e.g. 'ready', 'review') — just proceed
  log.debug('card_status_noop', `Card ${cardId} has status ${card.status} — no checkout needed`);
}

// ---------------------------------------------------------------------------
// FRW-BL-025: root-cause + retry for burst-spawn worktree creation.
//
// ROOT CAUSE (confirmed): `git worktree add` acquires the repository's
// index.lock / worktree administrative lock. When N developer subagents are
// spawned in a single message, N WorktreeCreate hooks run concurrently and
// serialise on that lock. Two failure shapes were observed under the CLEAR
// wave-1 burst (clear session-summary 38, 2026-05-18..19):
//   1. SLOW PATH  — a later invocation blocks on the lock long enough to
//      exceed the WorktreeCreate hook timeout; the Agent framework kills the
//      hook and surfaces the bare "Hook cancelled". Mitigated by raising the
//      hook timeout 3s -> 15s (commit 2c152c9, .claude/settings.json).
//   2. FAST-FAIL PATH — git returns immediately with a lock error
//      ("cannot lock ref", "index.lock: File exists", "another git process")
//      because a sibling `worktree add` holds the lock. Previously this path
//      exited 2 with no classification, indistinguishable from a genuine
//      fatal error and reported to the parent as a silent cancel.
// This change adds bounded retry-with-backoff for the FAST-FAIL path and emits
// a CLASSIFIED stderr message on final failure so the cancel reason is visible.
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Classify a `git worktree add` failure from its stderr / message text.
//  - 'lock-contention' : transient; a sibling git process holds the lock -> retry
//  - 'worktree-exists' : target branch/dir already present -> NOT transient
//  - 'fatal'           : anything else -> NOT transient
function classifyGitError(text) {
  const t = (text || '').toLowerCase();
  if (/index\.lock|cannot lock ref|unable to lock|another git process|lock file|\.lock['"]?: file exists/.test(t)) {
    return 'lock-contention';
  }
  if (/already exists|already checked out|already registered|already used by worktree/.test(t)) {
    return 'worktree-exists';
  }
  return 'fatal';
}

// Default git invocation (synchronous). The self-test injects an async impl
// (promisified execFile) so it can drive real concurrent adds against a temp
// repo and exercise genuine lock contention.
function defaultGitWorktreeAdd(branch, worktreeDir, projectRoot) {
  execSync(`git worktree add -b "${branch}" "${worktreeDir}" HEAD`, {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Create the worktree, retrying ONLY on transient lock contention. Never calls
// process.exit — returns a result object and lets the caller decide. The git
// call is awaited so an injected async impl (the concurrent self-test) works;
// awaiting the sync default is a harmless no-op.
async function createWorktreeWithRetry(branch, worktreeDir, projectRoot, opts = {}) {
  const maxAttempts = opts.maxAttempts || 3;
  const baseDelayMs = opts.baseDelayMs != null ? opts.baseDelayMs : 200;
  const gitAdd = opts.gitWorktreeAdd || defaultGitWorktreeAdd;
  const sleepImpl = opts.sleepImpl || sleep;

  let lastError = null;
  let classification = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
      await gitAdd(branch, worktreeDir, projectRoot);
      return { ok: true, attempts: attempt, classification: null, lastError: null };
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : (e.message || '');
      lastError = stderr;
      classification = classifyGitError(stderr);
      // Only lock contention is retryable; everything else fails fast.
      if (classification !== 'lock-contention' || attempt === maxAttempts) {
        return { ok: false, attempts: attempt, classification, lastError };
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 200, 400, 800...
      log.warn('worktree_add_retry',
        `git worktree add hit ${classification} (attempt ${attempt}/${maxAttempts}) — backing off ${delay}ms`,
        { branch, attempt, delay });
      await sleepImpl(delay);
    }
  }
  return { ok: false, attempts: maxAttempts, classification, lastError };
}

async function main() {
  const input = readStdin();

  const name = input.name || `wt-${Date.now()}`;
  const agentId = input.agent_id || '';
  const agentType = input.agent_type || '';
  const cwd = input.cwd || process.cwd();

  // Determine project root: use active project path from registry if available,
  // fall back to cwd (which is the Volundr framework repo, not necessarily the target project)
  let projectRoot = cwd;
  try {
    const vldrHome = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
    const regPath = path.join(vldrHome, 'projects', 'registry.json');
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      const activeId = reg.activeProject;
      if (activeId && reg.projects && reg.projects[activeId] && reg.projects[activeId].path) {
        const activePath = reg.projects[activeId].path;
        // Verify the path exists and is a git repo
        if (fs.existsSync(activePath) && fs.existsSync(path.join(activePath, '.git'))) {
          projectRoot = activePath;
          log.info('project_root_resolved', `Using active project path: ${activePath} (project: ${activeId})`);
        }
      }
    }
  } catch (e) {
    log.warn('registry_read_failed', `Could not read registry, falling back to cwd: ${e.message}`);
  }

  // Gate 2: best-effort checkout of the card this spawn is serving.
  // Peek (do NOT pop) the descriptor queue — agent-start.js will consume it later.
  // All failures degrade silently — worktree creation is never blocked by API errors.
  // Inserted AFTER projectRoot resolution and BEFORE git worktree add.
  try {
    const cardId = resolveCardIdFromQueue();
    if (cardId) {
      log.debug('card_id_resolved', `Resolved cardId ${cardId} from descriptor queue`);
      await attemptCardCheckout(cardId);
    } else {
      log.debug('no_card_id', 'No cardId in descriptor queue — Volundr-direct or planner spawn, proceeding normally');
    }
  } catch (e) {
    // Belt-and-suspenders: any unexpected error in the gate must not block worktree creation
    log.debug('checkout_gate_error', `Checkout gate threw unexpectedly: ${e.message} — proceeding`);
  }

  const worktreeDir = path.join(projectRoot, '.claude', 'worktrees', name);
  const branch = `worktree/${name}`;

  // Create the worktree using git, retrying on transient lock contention
  // (FRW-BL-025). On final failure, emit a CLASSIFIED message naming the path
  // that triggered the cancel so it is never a silent "Hook cancelled" again.
  const result = await createWorktreeWithRetry(branch, worktreeDir, projectRoot);
  if (!result.ok) {
    const reason = result.classification === 'lock-contention'
      ? `git index/worktree lock contention persisted after ${result.attempts} attempts (burst-spawn). Sibling worktree adds did not release the lock in time.`
      : result.classification === 'worktree-exists'
        ? `target worktree branch/dir already exists (${branch}). A prior spawn likely created it — not transient.`
        : 'git worktree add failed with a non-transient error.';
    const lastLine = (result.lastError || '').trim().split('\n').slice(-3).join(' | ');
    const msg = [
      `WorktreeCreate FAILED [path: git-worktree-add | class: ${result.classification}]`,
      `  ${reason}`,
      `  branch:   ${branch}`,
      `  attempts: ${result.attempts}`,
      `  git says: ${lastLine}`,
    ].join('\n');
    log.error('worktree_create_failed', msg, {
      agentId,
      name,
      classification: result.classification,
      attempts: result.attempts,
    });
    process.stderr.write(msg + '\n');
    process.exit(2); // Block - worktree creation failed (now classified, not silent)
  }
  if (result.attempts > 1) {
    log.info('worktree_create_recovered',
      `Worktree created after ${result.attempts} attempts (lock contention auto-recovered)`,
      { branch, attempts: result.attempts });
  }

  log.info('worktree_created', `Worktree created: ${branch} at ${worktreeDir}`, {
    agentId,
    agentType,
    worktreePath: worktreeDir,
    branch,
  });

  // Save mapping for WorktreeRemove to read
  const mapKey = Buffer.from(worktreeDir).toString('base64url').slice(0, 60);
  const mapFile = path.join(getWorktreeMapDir(), mapKey);
  try {
    fs.writeFileSync(mapFile, JSON.stringify({
      path: worktreeDir,
      branch,
      name,
      agentId,
      agentType,
      createdAt: new Date().toISOString(),
    }));
  } catch (e) {
    log.warn('mapping_write_failed', `Could not write worktree mapping: ${e.message}`);
  }

  // Log event to dashboard (non-blocking - don't let API failure block worktree)
  if (PROJECT_ID) {
    apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'agent_spawned',
      detail: `Worktree created: ${branch} (${agentType || 'unknown'})`,
    }).catch(() => {});
  }

  // Output the worktree path - this is required by the contract
  process.stdout.write(worktreeDir);
}

// Only run main() when invoked directly. Tests `require()` this module to access
// the helper exports below — without this guard, every require would trigger a
// real `git worktree add` as a side effect.
if (require.main === module) {
  main().catch((e) => {
    log.error('unhandled_error', e.message, { error: e.stack });
    process.exit(2);
  });
}

module.exports = { resolveCardIdFromQueue, classifyGitError, createWorktreeWithRetry };
