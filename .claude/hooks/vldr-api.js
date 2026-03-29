// Shared dashboard API utility for hook scripts
// All hooks import this for dashboard communication
// Errors are swallowed - hooks must never block agent work

const fs = require('fs');
const os = require('os');
const path = require('path');

const API_URL = process.env.VLDR_API_URL || 'http://localhost:3141';
const VLDR_HOME = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
const PROJECT_ID = process.env.VLDR_PROJECT_ID || (() => {
  // Fallback: read activeProject from registry.json in VLDR_HOME
  try {
    const fs = require('fs');
    // Try VLDR_HOME first, then legacy repo-relative path
    const vldrHomePath = path.join(VLDR_HOME, 'projects', 'registry.json');
    const legacyPath = path.resolve(__dirname, '../../projects/registry.json');
    const registryPath = fs.existsSync(vldrHomePath) ? vldrHomePath : legacyPath;
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return registry.activeProject || '';
  } catch {
    return '';
  }
})();

async function apiPost(path, body) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiPatch(path, body) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiGet(path) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function readStdin() {
  try {
    // Use fd 0 (stdin) directly - works on Windows and Unix
    const data = require('fs').readFileSync(0, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Auto-heartbeat: debounced 5s, fires on any hook activity
// Uses the mapped volundr agent ID from agent-map, not a synthetic ID
let lastHeartbeat = 0;
function touchHeartbeat() {
  const now = Date.now();
  if (now - lastHeartbeat < 5000) return; // debounce 5s
  lastHeartbeat = now;
  if (!PROJECT_ID) return;
  // Read the actual agent ID from the mapping file written by session-start.js
  const mapFile = path.join(os.tmpdir(), 'mc-agent-map', 'volundr-lead');
  let agentId;
  try { agentId = fs.readFileSync(mapFile, 'utf8').trim(); } catch { return; }
  if (!agentId) return;
  // Fire and forget - non-blocking
  apiPatch(`/api/agents/${agentId}`, { detail: `heartbeat:${new Date().toISOString()}` }).catch(() => {});
}

// Auto-touch on module load (every hook import triggers this)
touchHeartbeat();

module.exports = { apiPost, apiPatch, apiGet, readStdin, touchHeartbeat, API_URL, PROJECT_ID, VLDR_HOME };
