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

    // Quality gate: check BEFORE patching card to done
    // If gate fails, card stays in_progress and task completion is blocked
    const qualityRows = await apiGet(`/api/projects/${PROJECT_ID}/quality`);
    if (Array.isArray(qualityRows)) {
      const match = qualityRows.find(r => r.cardId === cardId);
      if (match && typeof match.weightedScore === 'number' && match.weightedScore < 2.5) {
        await apiPost('/api/events', {
          projectId: PROJECT_ID,
          type: 'quality_gate_failed',
          cardId,
          detail: `Quality gate blocked ${cardId}: score ${match.weightedScore} < 2.5`,
        });
        log.warn('quality_gate_failed', `${cardId} score ${match.weightedScore} below threshold`, { cardId });
        process.stderr.write(
          `Quality gate failed for ${cardId}: score ${match.weightedScore} below threshold 2.5. Fix quality issues before completing.\n`
        );
        process.exit(2); // Block completion - card stays in_progress
      }
      // No score yet or score >= 2.5 - allow completion
    }

    // Gate passed - patch card to done
    const patchResult = await apiPatch(`/api/cards/${cardId}`, {
      status: 'done',
      completedAt: new Date().toISOString(),
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
