// enforce-card-deps.js - PreToolUse:Agent hook
// Checks card deps and agent concurrency limits before spawning an agent. HARD enforcement.

const { readStdin, apiGet, apiPost, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const log = createLogger('enforce-card-deps');

async function main() {
  if (!PROJECT_ID) return;

  const input = readStdin();
  const text = (input.tool_input?.prompt || '') + ' ' + (input.tool_input?.description || '');

  // Agent concurrency limits
  const runningAgents = await apiGet(`/api/projects/${PROJECT_ID}/agents?status=running`);
  if (runningAgents && runningAgents.length > 0) {
    const devCount = runningAgents.filter(a => a.type === 'developer').length;
    if (devCount >= 4) {
      const msg = `BLOCKED: Max 4 concurrent developer agents reached (${devCount} running). Wait for one to finish.`;
      log.warn('agent_limit_developer', msg);
      process.stderr.write(msg + '\n');
      process.exit(2);
    }
    if (runningAgents.length >= 12) {
      const msg = `BLOCKED: Max 12 total agents reached (${runningAgents.length} running). Wait for one to finish.`;
      log.warn('agent_limit_total', msg);
      process.stderr.write(msg + '\n');
      process.exit(2);
    }
  }

  // Try to extract a card ID from the prompt/description
  const cardMatch = text.match(/CARD-[A-Z]+-\d+/);
  if (!cardMatch) return; // No card ID found - allow spawn

  const cardId = cardMatch[0];

  // Check card deps
  const card = await apiGet(`/api/cards/${cardId}`);
  if (!card || !card.deps || card.deps.length === 0) return;

  const allCards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
  const undone = card.deps.filter(depId => {
    const dep = allCards && allCards.find(c => c.id === depId);
    return !dep || dep.status !== 'done';
  });

  if (undone.length > 0) {
    await apiPost('/api/events', {
      projectId: PROJECT_ID,
      type: 'dep_gate_blocked',
      cardId,
      detail: `Agent spawn blocked for ${cardId}: deps not done: ${undone.join(', ')}`,
    });
    const msg = `BLOCKED: ${cardId} has unfinished deps: ${undone.join(', ')}. Complete them first.`;
    log.warn('dep_gate_blocked', msg, { cardId });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }

  // Type contract check: look for a type/interface card in the same epic that isn't done
  const epicPrefix = cardId.replace(/-\d+$/, '');
  const typeCard = allCards && allCards.find(c =>
    c.id !== cardId &&
    c.id.startsWith(epicPrefix) &&
    c.status !== 'done' &&
    /type|interface/i.test(c.title || '')
  );
  if (typeCard) {
    const msg = `BLOCKED: Type/interface card ${typeCard.id} ("${typeCard.title}") in the same epic is not done. Complete it before spawning ${cardId}.`;
    log.warn('type_contract_blocked', msg, { cardId });
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
}

main().catch((e) => { log.error('unhandled_error', e.message, { error: e.stack }); });
