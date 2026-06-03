// post-compact.js - PostCompact hook (FRW-BL-033)
// Fires AFTER Claude Code compacts the context window. A compaction can silently
// drop load-bearing context, so this hook RE-ASSERTS the HOT tier (project / phase /
// gate + card-status counts) and RE-INJECTS the active project's steering rules + top
// lessons as additionalContext, and logs a `compaction_completed` dashboard event so
// the compaction is observable in the feed.
//
// Claude Code feature reference: PostCompact hook event (fires after compaction; the
// trigger `manual`|`auto` is exposed via the settings.json matcher). The exact stdin
// shape is NOT pinned by an authoritative schema, so the trigger is read DEFENSIVELY
// from several candidate fields and never assumed.
//
// Memory safety (FRW-BL-048 / FRW-BL-069): steering rules + lessons are
// author-influenced PERSISTENT memory and a prompt-injection vector. They are routed
// through memory-loader.wrapAllMemory — the single enforced code path that fences each
// item as untrusted DATA and gates it with the SIGNED integrity manifest — exactly as
// session-start.js does for the HOT tier. Never inject raw persisted text.
//
// Contract: command-type, guarded behind `if (require.main === module)`, and degrades
// GRACEFULLY (exit 0) on ANY error — a context-injection hook must never break the session.

const { apiGet, apiPost, readStdin, PROJECT_ID, VLDR_HOME } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const { defangMarkers, wrapAsData } = require('./memory-guard');
const { wrapAllMemory } = require('./memory-loader');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = createLogger('post-compact');

async function main() {
  const input = readStdin();
  // Trigger is surfaced via the matcher (manual|auto); also probe stdin defensively.
  const trigger = input.trigger || input.compaction_reason || input.matcher || input.source || 'unknown';

  if (!PROJECT_ID) {
    log.debug('no_project', 'PostCompact: no active project — nothing to re-assert');
    return;
  }

  // Observability: record the compaction in the dashboard events feed.
  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'compaction_completed',
    detail: `Context compaction completed (${trigger}). Re-asserting HOT-tier state + constraints + lessons.`,
  });
  log.info('compaction_completed', `Compaction finished (trigger: ${trigger}) — re-asserting HOT tier`);

  // 1. Re-assemble the HOT tier: project / phase / gate + card-status counts.
  let ctx = '## HOT Tier — re-asserted after compaction\n';
  try {
    const project = await apiGet(`/api/projects/${PROJECT_ID}`);
    const cards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
    if (project) {
      const safeName = defangMarkers(String(project.name ?? '').replace(/[\r\n]+/g, ' ')).slice(0, 120);
      ctx += `Project: ${safeName} | Phase: ${project.phase} | Gate: Level ${project.reviewGateLevel}\n`;
    }
    if (Array.isArray(cards)) {
      const counts = {};
      cards.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
      ctx += `Cards: ${JSON.stringify(counts)}\n`;
    }
  } catch (e) {
    log.debug('hot_assemble_failed', `HOT re-assembly skipped: ${e.message}`);
  }

  // 2. Re-inject author-influenced memory, fenced as untrusted DATA.
  const fenced = [];

  // Steering rules live in the on-disk constraints.md — an attacker with VLDR_HOME write
  // access could poison that FILE — so they get the FULL manifest-gated wrapAllMemory path
  // (tamper detection + signed-manifest gate), exactly like session-start's HOT tier.
  const ruleItems = [];
  try {
    const mcHome = VLDR_HOME || path.join(os.homedir(), '.volundr');
    const constraintsPath = path.join(mcHome, 'projects', PROJECT_ID, 'constraints.md');
    if (fs.existsSync(constraintsPath)) {
      const content = fs.readFileSync(constraintsPath, 'utf-8');
      const rulesMatch = content.match(/## Steering Rules\n([\s\S]*?)(?=\n## |$)/);
      if (rulesMatch) {
        const rules = rulesMatch[1].trim().split('\n').filter(l => l.startsWith('- [')).slice(-5);
        if (rules.length > 0) ruleItems.push({ id: 'steering', kind: 'steering-rules', content: rules.join('\n') });
      }
    }
  } catch (e) { /* non-fatal */ }
  if (ruleItems.length > 0) {
    try {
      const safe = wrapAllMemory(ruleItems, { warn: (event, msg, meta) => log.warn(event, msg, meta || {}) });
      if (safe && safe.text) fenced.push(safe.text);
    } catch (e) {
      log.debug('memory_wrap_skipped', `Steering re-injection skipped on wrap failure: ${e.message}`);
    }
  }

  // Top lessons are FRESH dashboard DB rows (not a loaded file) and change often, so
  // manifest tamper-gating would just withhold normal updates. Fence them as untrusted
  // DATA to neutralize any embedded instructions, WITHOUT the tamper-gate — wrapAsData.
  try {
    const lessons = await apiGet(`/api/projects/${PROJECT_ID}/lessons?limit=3`);
    if (Array.isArray(lessons) && lessons.length > 0) {
      // The lessons route may ignore ?limit — cap client-side to the TOP few.
      const text = lessons.slice(0, 3).map(l => `- [${l.stack || 'general'}] ${l.title}`).join('\n');
      fenced.push(wrapAsData(`Top lessons:\n${text}`, { kind: 'lessons', id: 'top-lessons' }));
    }
  } catch (e) { /* non-fatal — lessons endpoint optional */ }

  if (fenced.length > 0) ctx += `\n${fenced.join('\n\n')}\n`;

  // 3. Emit as additionalContext so the re-asserted state survives into the next turn.
  try {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostCompact', additionalContext: ctx } }));
  } catch (e) { /* never break the session */ }
}

if (require.main === module) {
  main().catch((e) => {
    // GRACEFUL DEGRADE: never break the session on a context-injection hook failure.
    try { log.error('unhandled_error', e.message, { error: e.stack }); } catch { /* ignore */ }
    process.exit(0);
  });
}

module.exports = { main };
