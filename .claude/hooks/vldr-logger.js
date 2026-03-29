// Structured logger for Volundr hooks
// Dual output: synchronous file + fire-and-forget API POST

const fs = require('fs');
const path = require('path');
const os = require('os');

const VLDR_HOME = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
const API_URL = process.env.VLDR_API_URL || 'http://localhost:3141';

function getLogDir() {
  const dir = path.join(VLDR_HOME, 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true }); // idempotent under concurrent hooks
  } catch { /* directory exists or can't be created */ }
  return dir;
}

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(getLogDir(), `${date}.jsonl`);
}

// Resolve project ID from registry (same logic as vldr-api.js)
function getProjectId() {
  try {
    const registryPath = path.join(VLDR_HOME, 'projects', 'registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return registry.activeProject || null;
  } catch {
    return null;
  }
}

/**
 * Create a logger instance for a specific hook source.
 * @param {string} source - The hook name (e.g., 'agent-start', 'session-stop')
 * @returns Logger with debug/info/warn/error/fatal methods
 */
function createLogger(source) {
  const projectId = process.env.VLDR_PROJECT_ID || getProjectId();

  function log(level, event, detail, extra = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      event,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
      projectId: extra.projectId || projectId,
      agentId: extra.agentId || null,
      cardId: extra.cardId || null,
      error: extra.error ? String(extra.error).slice(0, 2000) : null,
    };

    // 1. Synchronous file write (always - even if API is down)
    try {
      fs.appendFileSync(getLogFile(), JSON.stringify(entry) + '\n');
    } catch {
      // Can't write to log file - last resort stderr
      process.stderr.write(`[vldr-logger] Failed to write log: ${JSON.stringify(entry)}\n`);
    }

    // 2. Fire-and-forget API POST (non-blocking)
    try {
      fetch(`${API_URL}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {}); // Swallow - file log is the reliable fallback
    } catch {
      // fetch not available or other error - file log has it
    }

    return entry;
  }

  return {
    debug: (event, detail, extra) => log('debug', event, detail, extra),
    info: (event, detail, extra) => log('info', event, detail, extra),
    warn: (event, detail, extra) => log('warn', event, detail, extra),
    error: (event, detail, extra) => log('error', event, detail, extra),
    fatal: (event, detail, extra) => log('fatal', event, detail, extra),
  };
}

module.exports = { createLogger };
