// TaskCompleted hook - auto-update card status in dashboard
// Fires when a task is marked complete in Agent Teams task list
// Convention: task subjects start with card ID, e.g. "CARD-FG-002: Custom graph node"

const { apiPatch, apiPost, apiGet, readStdin, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('task-completed');

async function main() {
  const input = readStdin();
  if (!PROJECT_ID) {
    log.warn('no_project_id', 'VLDR_PROJECT_ID not set - skipping task-completed hook');
    return;
  }

  // Try to extract card ID from task subject
  const cardMatch = (input.task_subject || '').match(/^(CARD-[A-Z]+-\d+)/);

  if (cardMatch) {
    const cardId = cardMatch[1];

    // Dep check: verify all card deps are done before allowing completion
    const card = await apiGet(`/api/cards/${cardId}`);
    if (card && card.deps && card.deps.length > 0) {
      const allCards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
      const undone = card.deps.filter(depId => {
        const dep = allCards && allCards.find(c => c.id === depId);
        return !dep || dep.status !== 'done';
      });
      if (undone.length > 0) {
        process.stderr.write(`Deps incomplete for ${cardId}: ${undone.join(', ')} not done.\n`);
        process.exit(2);
      }
    }

    // Build gate check: verify a recent build_gate_passed event exists (project-wide, not per-card)
    // Per-card build gate events aren't always available — teammate-idle hook logs them without cardId
    const events = await apiGet(`/api/projects/${PROJECT_ID}/events?type=build_gate_passed&limit=1`);
    if (!events || events.length === 0) {
      process.stderr.write(`Build gate: No build_gate_passed event found for project. Run build gate first.\n`);
      process.exit(2);
    }

    // Quality gate: check BEFORE patching card to done
    // If gate fails, card stays in_progress and task completion is blocked
    const qualityRows = await apiGet(`/api/projects/${PROJECT_ID}/quality`);
    if (Array.isArray(qualityRows)) {
      const match = qualityRows.find(r => r.cardId === cardId);
      if (!match) {
        await apiPost('/api/events', {
          projectId: PROJECT_ID,
          type: 'quality_gate_failed',
          cardId,
          detail: `Quality gate blocked ${cardId}: no quality score exists`,
        });
        process.stderr.write(`Quality gate: ${cardId} has no quality score. Score the card before completing.\n`);
        process.exit(2);
      }
      if (typeof match.weightedScore === 'number' && match.weightedScore < 5.0) {
        await apiPost('/api/events', {
          projectId: PROJECT_ID,
          type: 'quality_gate_failed',
          cardId,
          detail: `Quality gate blocked ${cardId}: score ${match.weightedScore} < 5.0`,
        });
        log.warn('quality_gate_failed', `${cardId} score ${match.weightedScore} below threshold`, { cardId });
        process.stderr.write(
          `Quality gate failed for ${cardId}: score ${match.weightedScore} below threshold 5.0. Fix quality issues before completing.\n`
        );
        process.exit(2); // Block completion - card stays in_progress
      }
    }

    // Gate passed - patch card to done (include quality scores for API gate)
    const qualityObj = match ? {
      completeness: match.completeness,
      codeQuality: match.codeQuality,
      formatCompliance: match.formatCompliance,
      independence: match.independence,
      implementationType: match.implementationType || 'agent',
    } : undefined;
    const patchResult = await apiPatch(`/api/cards/${cardId}`, {
      status: 'done',
      completedAt: new Date().toISOString(),
      ...(qualityObj && { quality: qualityObj }),
    });
    if (!patchResult) {
      // Check if the failure was due to ISC gate rejection
      const card = await apiGet(`/api/cards/${cardId}`);
      if (card && card.isc) {
        const isc = typeof card.isc === 'string' ? JSON.parse(card.isc) : card.isc;
        const unverified = (isc || []).filter(c => c.passed === null);
        if (unverified.length > 0) {
          process.stderr.write(`ISC incomplete for ${cardId}: ${unverified.length}/${isc.length} criteria unverified\n`);
          process.exit(2);
        }
      }
      process.stderr.write(`Failed to patch card ${cardId} to done\n`);
      process.exit(2);
    }

    const postResult = await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'card_status_changed',
      cardId,
      detail: `${cardId} completed by ${input.teammate_name || 'agent'}`,
    });
    if (!postResult) {
      log.warn('event_post_failed', `Failed to post card_status_changed event for ${cardId}`, { cardId });
    }
  } else {
    // No card ID found - log generic event
    const postResult = await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'card_status_changed',
      detail: `Task completed: ${(input.task_subject || 'unknown').slice(0, 60)}`,
    });
    if (!postResult) {
      log.warn('event_post_failed', `Failed to post generic task_completed event for: ${(input.task_subject || 'unknown').slice(0, 60)}`);
    }
  }

  // Exit 0 = allow task completion
}

main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
