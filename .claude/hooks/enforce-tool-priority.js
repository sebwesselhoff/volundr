// PreToolUse:Skill — SOFT enforcement hook
// Logs when plugin skills are invoked during active card work without explicit user request.
// This is SOFT — it allows the skill to run but records the event for compliance tracking.

const { readStdin, apiPost, PROJECT_ID } = require('./vldr-api');
const { createLogger } = require('./vldr-logger');

const log = createLogger('enforce-tool-priority');

const FRAMEWORK_SKILLS = [
  'vldr-doctor',
  'vldr-journal',
  'vldr-shutdown',
  'vldr-compact',
  'vldr-status',
  'vldr-directive',
  'vldr-route',
];

async function main() {
  const input = readStdin();
  const skillName = input.tool_input?.skill || '';

  // Framework skills are always allowed — no logging needed
  if (FRAMEWORK_SKILLS.some(s => skillName.includes(s))) return;

  // If no active project, allow without logging (boot sequence or standalone use)
  if (!PROJECT_ID) return;

  // Log compliance event for plugin skill usage during active card work
  await apiPost('/api/events', {
    projectId: PROJECT_ID,
    type: 'tool_priority_override',
    detail: `Plugin skill '${skillName}' invoked. Framework personas should handle implementation; plugins are supplementary.`,
  });

  log.info('tool_priority_logged', `Plugin skill invoked: ${skillName}`);

  // Exit 0 = allow (SOFT enforcement only)
}

main().catch(e => log.error('unhandled', e.message));
