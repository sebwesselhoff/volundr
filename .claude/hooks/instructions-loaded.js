// instructions-loaded.js - InstructionsLoaded hook (GUARDRAIL)
// Fires after Claude Code loads its instruction set (CLAUDE.md / memory /
// system instructions) for a session. Volundr uses it to CONFIRM its two
// load-bearing context files are actually present + non-empty:
//   1. framework/system-instructions.md  (the operating manual)
//   2. the ACTIVE project's constraints.md (per-project guardrails)
// If either is missing/empty, the orchestrator may be running blind, so this
// hook WARNS — both on stderr (visible feedback) and as a dashboard event.
//
// Claude Code feature reference: InstructionsLoaded hook event (CHANGELOG
// ~L2094, current official line — see framework/cc-version-baseline.md). The
// exact stdin shape is NOT pinned by an authoritative schema in this repo, so
// this hook does not depend on stdin fields at all: it verifies the files on
// disk DEFENSIVELY using the same path resolution the rest of the framework
// uses (CLAUDE_PROJECT_DIR / repo root for the framework file, VLDR_HOME +
// active project id for constraints). Defensive degrade is an explicit ISC.
//
// Contract: command-type, guarded behind `if (require.main === module)`, and
// degrades GRACEFULLY (exit 0) on ANY error — a guardrail hook must never break
// the session. A "missing file" WARNS but still exits 0 (advisory, never blocks).

const { readStdin, apiPost, PROJECT_ID, VLDR_HOME } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const fs = require('fs');
const path = require('path');
const log = createLogger('instructions-loaded');

// Resolve the framework system-instructions.md. The hook lives at
// <repo>/.claude/hooks/, OR inside a worktree at
// <repo>/.claude/worktrees/<wt>/.claude/hooks/. Prefer CLAUDE_PROJECT_DIR when
// the runtime provides it; otherwise climb from __dirname. We probe BOTH the
// two-levels-up layout and the worktree-nested layout, taking the first that exists.
function resolveSystemInstructions() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) {
    candidates.push(path.join(process.env.CLAUDE_PROJECT_DIR, 'framework', 'system-instructions.md'));
  }
  // <repo>/.claude/hooks/instructions-loaded.js -> ../../framework/...
  candidates.push(path.resolve(__dirname, '..', '..', 'framework', 'system-instructions.md'));
  // worktree: <repo>/.claude/worktrees/<wt>/.claude/hooks/ -> climb to repo root
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', 'framework', 'system-instructions.md'));
  return candidates;
}

// Resolve the active project's constraints.md under VLDR_HOME.
function resolveConstraints() {
  if (!PROJECT_ID) return null;
  return path.join(VLDR_HOME, 'projects', PROJECT_ID, 'constraints.md');
}

// A file "loaded" check: exists AND has meaningful (non-whitespace) content.
function fileLoaded(p) {
  try {
    if (!p || !fs.existsSync(p)) return false;
    const content = fs.readFileSync(p, 'utf8');
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

async function main() {
  readStdin(); // drain stdin defensively; this hook does not depend on its shape.

  const missing = [];

  // 1. framework/system-instructions.md — confirm at least one candidate resolves.
  const siCandidates = resolveSystemInstructions();
  const siFound = siCandidates.find(fileLoaded);
  if (siFound) {
    log.info('system_instructions_ok', `system-instructions.md present (${siFound})`);
  } else {
    missing.push('framework/system-instructions.md');
  }

  // 2. active project constraints.md — only checkable when a project is active.
  const constraintsPath = resolveConstraints();
  if (!PROJECT_ID) {
    // No active project (e.g. clean boot before project selection). Not a
    // failure — there is nothing to confirm yet. Breadcrumb only.
    log.debug('no_active_project', 'InstructionsLoaded: no active project — skipping constraints check');
  } else if (fileLoaded(constraintsPath)) {
    log.info('constraints_ok', `constraints.md present for ${PROJECT_ID}`);
  } else {
    missing.push(`constraints.md (project ${PROJECT_ID})`);
  }

  if (missing.length > 0) {
    const detail = `instructions-loaded: missing/empty load-bearing file(s): ${missing.join(', ')}`;
    // stderr — surfaced as feedback to the session.
    process.stderr.write(`WARNING: ${detail}\n`);
    log.warn('instructions_missing', detail, {});
    // dashboard event — so the gap is observable in the feed.
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'intervention',
      detail,
    });
  }
  // Always exit 0 — advisory only, never blocks the session.
}

if (require.main === module) {
  main().catch((e) => {
    // GRACEFUL DEGRADE: never break the session on a guardrail-hook failure.
    try { log.error('unhandled_error', e.message, { error: e.stack }); } catch { /* ignore */ }
    process.exit(0);
  });
}

module.exports = { resolveSystemInstructions, resolveConstraints, fileLoaded };
