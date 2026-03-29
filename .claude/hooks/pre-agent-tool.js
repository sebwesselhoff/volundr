// PreToolUse:Agent hook - capture Agent tool description before subagent spawns
// Writes description to a FIFO queue that agent-start.js reads
// Queue-based approach supports parallel spawns of the same subagent_type

const { readStdin } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = createLogger('pre-agent-tool');

function getQueueDir() {
  const dir = path.join(os.tmpdir(), 'mc-agent-map', 'desc-queue');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* ignore */ }
  return dir;
}

async function main() {
  const input = readStdin();

  // tool_input contains the Agent tool's parameters including description
  const toolInput = input.tool_input || {};
  const description = toolInput.description || '';
  const agentName = toolInput.name || '';
  const subagentType = toolInput.subagent_type || 'general-purpose';

  // Extract cardId and personaId from the prompt text if present
  // Convention: Volundr includes "# CARD-XX-NNN:" in the prompt header
  // and "personaId: xxx" or "Persona: xxx" in the prompt
  const prompt = toolInput.prompt || '';
  let cardId = null;
  let personaId = null;

  const cardMatch = prompt.match(/CARD-[A-Z0-9]+-\d{3}/);
  if (cardMatch) cardId = cardMatch[0];

  const personaMatch = prompt.match(/personaId[:\s]+["']?([a-z0-9-]+)["']?/i)
    || prompt.match(/## Persona[:\s]+\S+\s+\(([a-z0-9-]+)\)/i);
  if (personaMatch) personaId = personaMatch[1];

  if (description || agentName || cardId) {
    // Write to FIFO queue: filename = {subagentType}-{timestamp}-{random}
    // agent-start.js matches by subagent_type prefix and pops the oldest entry
    const typeKey = subagentType.replace(/[^a-z0-9-]/gi, '_');
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const queueFile = path.join(getQueueDir(), `${typeKey}-${ts}-${rand}`);
    try {
      fs.writeFileSync(queueFile, JSON.stringify({
        description,
        name: agentName,
        subagentType,
        cardId,
        personaId,
      }));
    } catch (e) {
      log.warn('desc_write_failed', `Could not write agent description: ${e.message}`);
    }
  }

  // Exit 0 = allow the Agent tool to proceed
}

main().catch((e) => {
  log.error('unhandled_error', e.message, { error: e.stack });
});
