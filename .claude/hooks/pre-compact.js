// PreCompact hook - preserve critical project state before context compaction
// Fires before compaction; can inject custom_instructions into the compacted context

const { apiGet, readStdin, PROJECT_ID, VLDR_HOME } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');

const log = createLogger('pre-compact');

async function main() {
  const input = readStdin();
  const trigger = input.trigger || 'unknown';

  log.info('compaction_starting', `Context compaction triggered: ${trigger}`);

  if (!PROJECT_ID) return;

  // Gather current project state from dashboard
  let stateLines = [`MC Project: ${PROJECT_ID}`, `VLDR_HOME: ${VLDR_HOME}`];

  const project = await apiGet(`/api/projects/${PROJECT_ID}`);
  if (project) {
    stateLines.push(`Phase: ${project.phase || 'unknown'}`);
    stateLines.push(`Gate Level: ${project.reviewGateLevel || 2}`);
  }

  const agents = await apiGet(`/api/projects/${PROJECT_ID}/agents?status=running`);
  if (agents && agents.length > 0) {
    const agentSummary = agents.map(a => `${a.type}(${a.detail || a.id.slice(0,8)})`).join(', ');
    stateLines.push(`Running agents: ${agentSummary}`);
  }

  const cards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
  if (cards) {
    const inProgress = cards.filter(c => c.status === 'in_progress').map(c => c.id);
    const blocked = cards.filter(c => c.status === 'blocked').map(c => c.id);
    if (inProgress.length > 0) stateLines.push(`In-progress cards: ${inProgress.join(', ')}`);
    if (blocked.length > 0) stateLines.push(`Blocked cards: ${blocked.join(', ')}`);
    const done = cards.filter(c => c.status === 'done').length;
    const total = cards.length;
    stateLines.push(`Progress: ${done}/${total} cards done`);
  }

  stateLines.push(`Dashboard: http://localhost:3141`);
  stateLines.push(`Recovery: mc.connect() → mc.project.get() → mc.cards.list()`);

  // Fetch recent journal entries for context that survives compaction
  const journalEntries = await apiGet(`/api/projects/${PROJECT_ID}/journal?limit=5`);
  if (journalEntries && journalEntries.length > 0) {
    stateLines.push('');
    stateLines.push('Recent context (from journal):');
    for (const j of journalEntries) {
      stateLines.push(`- [${j.entryType}] ${j.entry}`);
    }
  }

  // Output state as additional context that survives compaction
  const stateBlock = stateLines.join('\n');
  log.info('state_preserved', `Preserved ${stateLines.length} state lines for compaction`);

  // Write structured JSON to stdout - Claude Code reads hookSpecificOutput.custom_instructions
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      custom_instructions: stateBlock,
    },
  });
  process.stdout.write(output);
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
