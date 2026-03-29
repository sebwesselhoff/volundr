// Heartbeat utility — updates Volundr's agent record with current status
// Called by other hooks (agent-start, agent-stop, task-completed) to keep the dashboard live

const { apiGet, apiPatch, PROJECT_ID } = require('./vldr-api');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function updateHeartbeat(status, activeCard) {
  if (!PROJECT_ID) return;

  // Read volundr agent ID from mapping
  const mapFile = path.join(os.tmpdir(), 'mc-agent-map', 'volundr-lead');
  let volundrId = null;
  try {
    volundrId = fs.readFileSync(mapFile, 'utf8').trim();
  } catch (e) { return; } // No volundr agent registered yet

  if (!volundrId) return;

  // Count running agents (excluding volundr itself)
  let activeAgentCount = 0;
  try {
    const agents = await apiGet(`/api/projects/${PROJECT_ID}/agents?status=running`);
    if (agents) activeAgentCount = agents.filter(a => a.type !== 'volundr').length;
  } catch (e) { /* ignore */ }

  // Get card progress for context
  let cardProgress = '';
  try {
    const cards = await apiGet(`/api/projects/${PROJECT_ID}/cards`);
    if (cards && cards.length > 0) {
      const done = cards.filter(c => c.status === 'done').length;
      cardProgress = `${done}/${cards.length} cards`;
    }
  } catch (e) { /* ignore */ }

  // Build detail string for dashboard display
  const parts = ['Volundr'];
  if (status && status !== 'active') parts.push(status);
  if (activeCard) parts.push(activeCard);
  if (activeAgentCount > 0) parts.push(`${activeAgentCount} agent(s)`);
  if (cardProgress) parts.push(cardProgress);
  const detail = parts.join(' · ');

  await apiPatch(`/api/agents/${volundrId}`, { detail });
}

module.exports = { updateHeartbeat };
