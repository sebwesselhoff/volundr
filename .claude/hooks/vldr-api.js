// Shared dashboard API utility for hook scripts
// All hooks import this for dashboard communication
// Errors are swallowed - hooks must never block agent work

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

module.exports = { apiPost, apiPatch, apiGet, readStdin, API_URL, PROJECT_ID, VLDR_HOME };
