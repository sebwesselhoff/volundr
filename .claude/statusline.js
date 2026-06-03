// statusline.js — Claude Code statusLine command script
// Contract: CC invokes this after each assistant message (debounced ~300ms).
// stdin: JSON session object (see shape below). stdout: ONE line. exit 0 ALWAYS.
// NEVER print to stderr. NEVER call process.exit with non-zero.
// Degrades gracefully when dashboard is unavailable — prints stdin-sourced fields only.
//
// stdin JSON shape (defensive; fields may be absent/null):
//   session_id, model.display_name, cost.total_cost_usd,
//   context_window.used_percentage, effort.level

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ANSI helpers — color sparingly
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

const API     = process.env.VLDR_API_URL || 'http://localhost:3141';
const VLDR_HOME = process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');

// ── helpers ──────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getProjectId() {
  const envId = process.env.VLDR_PROJECT_ID;
  if (envId && envId.trim()) return envId.trim();
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(VLDR_HOME, 'projects', 'registry.json'), 'utf8'));
    return reg.activeProject || '';
  } catch {
    return '';
  }
}

async function apiFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Cache dashboard data ~5s per session in a temp file
function cacheRead(sessionId) {
  try {
    const file = path.join(os.tmpdir(), `vldr-statusline-${sessionId}`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < 5000) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch { /* miss */ }
  return null;
}

function cacheWrite(sessionId, data) {
  try {
    const file = path.join(os.tmpdir(), `vldr-statusline-${sessionId}`);
    fs.writeFileSync(file, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ── context bar ──────────────────────────────────────────────────────────────

function ctxBar(pct) {
  const p = pct ?? 0;
  const filled = Math.round(p / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = p >= 80 ? C.red : p >= 50 ? C.yellow : C.green;
  return `${color}${bar}${C.reset} ${p}%`;
}

// Gate level labels (reviewGateLevel: 1=autopilot,2=milestone,3=card,4=pair)
const GATE_LABELS = { 1: 'auto', 2: 'mile', 3: 'card', 4: 'pair' };

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sess = readStdin();

  // stdin-sourced values (always fresh)
  const sessionId  = (sess.session_id  || 'unknown').slice(0, 8);
  const model      = sess.model?.display_name || '?';
  const ctxPct     = sess.context_window?.used_percentage ?? null;   // may be null early/post-compact
  const costUsd    = sess.cost?.total_cost_usd ?? null;
  const effort     = sess.effort?.level || null;

  // ── dashboard data (cached / degraded) ───────────────────────────────────
  let activeCard   = null;
  let cardCount    = 0;
  let agentCount   = null;
  let gateLevel    = null;

  const projectId = getProjectId();
  if (projectId) {
    const cacheKey = `${sessionId}-${projectId}`;
    let cached = cacheRead(cacheKey);

    if (!cached) {
      // Parallel fetch — project info + cards + agents
      const [proj, cardsArr, agentsArr] = await Promise.all([
        apiFetch(`${API}/api/projects/${projectId}`),
        apiFetch(`${API}/api/projects/${projectId}/cards?status=in_progress`),
        apiFetch(`${API}/api/projects/${projectId}/agents?status=running`),
      ]);

      cached = {
        gateLevel:  proj?.reviewGateLevel ?? null,
        activeCard: Array.isArray(cardsArr) ? (cardsArr[0]?.id ?? null) : null,
        cardCount:  Array.isArray(cardsArr) ? cardsArr.length : 0,
        agentCount: Array.isArray(agentsArr) ? agentsArr.length : null,
      };
      cacheWrite(cacheKey, cached);
    }

    gateLevel  = cached.gateLevel;
    activeCard = cached.activeCard;
    cardCount  = cached.cardCount ?? 0;
    agentCount = cached.agentCount;
  }

  // ── render ────────────────────────────────────────────────────────────────
  const parts = [];

  // [vldr] prefix
  parts.push(`${C.bold}${C.cyan}[vldr]${C.reset}`);

  // Model
  parts.push(`${C.dim}model:${C.reset}${model}`);

  // Context bar (null → fallback 0 with visual indicator)
  const ctxLabel = ctxPct === null ? `${C.dim}ctx:--${C.reset}` : `ctx:${ctxBar(ctxPct)}`;
  parts.push(ctxLabel);

  // Cost
  if (costUsd !== null) {
    parts.push(`${C.dim}$${C.reset}${costUsd.toFixed(4)}`);
  }

  // Effort
  if (effort) {
    parts.push(`${C.dim}effort:${C.reset}${effort}`);
  }

  // Dashboard fields (only if available)
  if (activeCard) {
    const extra = cardCount > 1 ? `+${cardCount - 1}` : '';
    parts.push(`${C.dim}card:${C.reset}${activeCard}${extra}`);
  }

  if (agentCount !== null) {
    parts.push(`${C.dim}agents:${C.reset}${agentCount}`);
  }

  if (gateLevel !== null) {
    const label = GATE_LABELS[gateLevel] || String(gateLevel);
    parts.push(`${C.dim}gate:${C.reset}${label}`);
  }

  // Degraded indicator if dashboard was unreachable
  if (projectId && agentCount === null && activeCard === null && gateLevel === null) {
    parts.push(`${C.dim}(dashboard down)${C.reset}`);
  }

  process.stdout.write(parts.join('  ') + '\n');
}

// ── entry point ──────────────────────────────────────────────────────────────
main().catch(() => {
  try { process.stdout.write('[vldr] (degraded)\n'); } catch { /* nothing */ }
});
