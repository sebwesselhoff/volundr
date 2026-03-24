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

  if (description || agentName) {
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
