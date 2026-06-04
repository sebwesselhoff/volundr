#!/usr/bin/env node
/**
 * semantic-retrieval.mjs — similarity-ranked retrieval over LESSONS / JOURNAL / PATTERNS (FRW-BL-058).
 *
 * Volundr persists three long-term-memory sources and, until now, only ever retrieved them by
 * RECENCY + TIER (HOT/WARM/COLD). That answers "what happened most recently" but NOT "what is
 * RELEVANT to the card I am working on right now" — so a WARM/COLD lesson that is exactly on-topic
 * stays invisible behind newer, unrelated entries. This module adds RELEVANCE retrieval:
 *
 *   • A developer can ask "what did we learn about X" and get the lessons actually about X.
 *   • The autonomous loop can rank WARM/COLD context by similarity to the ACTIVE CARD
 *     (title + description + ISC), not just by recency/tier (ISC-2).
 *
 * RANKING MODEL (two paths, embeddings strictly OPTIONAL and OFF by default):
 *
 *   1. PRIMARY — zero-dependency TF-IDF (pure JS). Tokenize → term frequencies → inverse document
 *      frequency → per-doc sparse vectors → cosine similarity. This is the "zero-dependency
 *      SQLite/keyword fallback" the card asks for: a plain in-memory/JSON index, no SQLite, no npm
 *      deps. It is ALWAYS available and is what runs unless an embedder is explicitly configured.
 *
 *   2. OPTIONAL — embeddings. If (and only if) an embedder is configured (env `VLDR_EMBED_CMD`, or
 *      an injected `embed` function), each doc + the query are embedded to a dense number[] and we
 *      cosine-rank those instead. Absence / any failure → SILENT fallback to TF-IDF. The model is
 *      NEVER required; the contract is documented under `VLDR_EMBED_CMD` below.
 *
 * INJECTABILITY (the design rule that keeps this testable):
 *   The CORE ranking functions never touch the filesystem or the network. `buildIndex(docs, opts)`
 *   and `rank(index, query, k)` operate purely on an injected `docs` array of
 *   `{ id, text, source, date }`. File/API loading lives in SEPARATE, optional helpers
 *   (`loadCorpus`, `loadLessons*`, `loadPatterns`, `loadJournal`) that the CLI calls but tests do
 *   NOT. The embedder is likewise injected as a function, so the embedding branch is exercised in a
 *   unit test with a fake embedder — no real model, no network.
 *
 * DETERMINISM: no Date.now() in core ranking. Dates are DATA (passed in on each doc) used only for
 * display + recency tie-breaking; they never perturb the similarity score.
 *
 * Pure Node, ESM, NO external dependencies. Self-test: scripts/semantic-retrieval.test.mjs.
 *
 * ── VLDR_EMBED_CMD contract ──────────────────────────────────────────────────────────────────
 *   A shell command that reads ONE document's text on STDIN and writes a JSON array of numbers
 *   (the embedding vector) to STDOUT, e.g.  `python embed.py`  or  `my-embedder --model small`.
 *   It is invoked once per document at index-build time and once per query at rank time. All vectors
 *   it returns MUST have the same dimensionality. Any non-zero exit, non-JSON output, or empty
 *   result disables the embedding path for that run and we fall back to TF-IDF silently. OFF unless
 *   the env var is set.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// ── VLDR_HOME resolution ───────────────────────────────────────────────────────────────────────

/** Resolve VLDR_HOME: explicit env wins, else `~/.volundr` (mirrors framework/system-instructions). */
export function resolveVldrHome(env = process.env) {
  const v = env && env.VLDR_HOME;
  return v && String(v).trim() ? String(v) : join(homedir(), '.volundr');
}

// ── Tokenization ────────────────────────────────────────────────────────────────────────────────

/** A small, conventional English stop-word set. Removing these stops common-but-uninformative
 *  words ("the", "is", "to") from dominating the TF-IDF score, which is what lets a query like
 *  "what did we learn about X" home in on the content word X rather than the boilerplate. */
export const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'of',
  'on', 'or', 'our', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'us', 'was', 'we', 'were', 'what', 'when', 'which', 'while', 'who',
  'will', 'with', 'you', 'your', 'about',
]);

/**
 * Tokenize text into lowercase alphanumeric terms, dropping stop-words and 1-char noise.
 * Deterministic and pure. Used identically at index-build and query time so the vocabularies line up.
 * @param {string} text
 * @returns {string[]} lowercase content tokens (may contain duplicates — caller counts them)
 */
export function tokenize(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    // split on anything that is not a letter/digit; keep intra-word digits (e.g. "yaml", "v1", "frw").
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Term-frequency map for one token list: term → raw count. */
export function termFrequencies(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

// ── Cosine over sparse (Map) or dense (Array) vectors ─────────────────────────────────────────────

/** Cosine similarity for two sparse term→weight maps. 0 when either is empty/zero. */
export function cosineSparse(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  // iterate the smaller map for the dot product.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const o = big.get(term);
    if (o !== undefined) dot += w * o;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const w of a.values()) na += w * w;
  let nb = 0;
  for (const w of b.values()) nb += w * w;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Cosine similarity for two dense number[] (embedding) vectors. 0 on mismatch/empty. */
export function cosineDense(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Embedder resolution (optional, injectable) ────────────────────────────────────────────────────

/**
 * Resolve an embedder FUNCTION or null. Precedence:
 *   1. an injected `opts.embed` function (used directly — this is how tests exercise the branch);
 *   2. env `VLDR_EMBED_CMD` → wrap it as a function that pipes text on stdin and JSON-parses stdout;
 *   3. otherwise null → caller uses TF-IDF.
 * A wrapped command that throws / returns non-array is caught by the caller and degrades to TF-IDF.
 * @param {{embed?: (text:string)=>number[], env?: Record<string,string>}} [opts]
 * @returns {((text:string)=>number[]) | null}
 */
export function resolveEmbedder(opts = {}) {
  if (typeof opts.embed === 'function') return opts.embed;
  const env = opts.env || process.env;
  const cmd = env && env.VLDR_EMBED_CMD;
  if (cmd && String(cmd).trim()) {
    return (text) => {
      const out = execSync(cmd, { input: String(text == null ? '' : text), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      const vec = JSON.parse(out);
      if (!Array.isArray(vec) || vec.length === 0 || !vec.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error('VLDR_EMBED_CMD did not return a non-empty JSON number[]');
      }
      return vec;
    };
  }
  return null;
}

// ── Index build ──────────────────────────────────────────────────────────────────────────────────

/**
 * Build a similarity index over an INJECTED docs array. Pure with respect to I/O EXCEPT the optional
 * embedder, which is only invoked when one is configured; with the default (no embedder) this is a
 * fully deterministic, dependency-free TF-IDF index.
 *
 * Returned index shape (the test asserts on `mode` and per-doc vectors):
 *   {
 *     mode: 'tfidf' | 'embedding',
 *     docs:  [{ id, source, date, snippet }],   // metadata for display (text dropped to keep it small)
 *     idf:   { term: number } | null,           // tfidf only
 *     vectors: [ Map<term,weight> ]  |  [ number[] ],  // ONE per doc, same order as docs
 *     dim:   number | null,                      // embedding dimensionality, when mode === 'embedding'
 *     N:     number,                             // doc count
 *   }
 *
 * @param {Array<{id:string|number, text:string, source?:string, date?:string}>} docs
 * @param {{ embed?: (t:string)=>number[], env?: Record<string,string>, snippetLen?: number }} [opts]
 * @returns {object} index
 */
export function buildIndex(docs, opts = {}) {
  const list = Array.isArray(docs) ? docs.filter((d) => d && d.text != null) : [];
  const snippetLen = opts.snippetLen || 160;
  const meta = list.map((d) => ({
    id: d.id,
    source: d.source || 'unknown',
    date: d.date || null,
    snippet: makeSnippet(d.text, snippetLen),
  }));

  // Try the OPTIONAL embedding path. Any failure (no embedder, throw, dim mismatch) → TF-IDF.
  const embed = resolveEmbedder(opts);
  if (embed) {
    try {
      const vectors = list.map((d) => embed(d.text));
      const dim = vectors.length ? vectors[0].length : 0;
      if (dim > 0 && vectors.every((v) => Array.isArray(v) && v.length === dim)) {
        return { mode: 'embedding', docs: meta, idf: null, vectors, dim, N: list.length };
      }
    } catch {
      // fall through to TF-IDF
    }
  }

  // PRIMARY: zero-dependency TF-IDF.
  const tfs = list.map((d) => termFrequencies(tokenize(d.text)));

  // document frequency per term, then smoothed IDF: log((N+1)/(df+1)) + 1 (always > 0, no div-by-0).
  const df = new Map();
  for (const tf of tfs) {
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const N = list.length;
  const idf = {};
  for (const [term, d] of df) idf[term] = Math.log((N + 1) / (d + 1)) + 1;

  // per-doc TF-IDF weight vector (sparse Map term → tf * idf).
  const vectors = tfs.map((tf) => {
    const v = new Map();
    for (const [term, count] of tf) v.set(term, count * idf[term]);
    return v;
  });

  return { mode: 'tfidf', docs: meta, idf, vectors, dim: null, N };
}

/** First `len` chars of a single-spaced version of text, with an ellipsis when truncated. */
export function makeSnippet(text, len = 160) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : `${s.slice(0, len - 1)}…`;
}

// ── Query vectorization ──────────────────────────────────────────────────────────────────────────

/** Build a query vector in the SAME space as the index (sparse TF-IDF, or dense embedding). */
function vectorizeQuery(index, queryText, embed) {
  if (index.mode === 'embedding') {
    return embed(queryText); // caller guarantees embed is the same fn used to build the index
  }
  const tf = termFrequencies(tokenize(queryText));
  const v = new Map();
  for (const [term, count] of tf) {
    const idf = index.idf && index.idf[term];
    if (idf) v.set(term, count * idf); // unknown terms (not in corpus) carry no weight
  }
  return v;
}

// ── Rank ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Rank indexed docs by similarity to a free-text query. Returns the top-k as
 * `{ id, source, date, snippet, score }`, highest score first. Pure: no I/O for the TF-IDF path; for
 * the embedding path it calls the SAME injected embedder used at build time (passed via opts.embed or
 * VLDR_EMBED_CMD) to vectorize the query. Ties broken by more-recent `date` (recency only DECIDES
 * ties — it never overrides a higher similarity score, which is the whole point of ISC-2).
 *
 * @param {object} index output of buildIndex
 * @param {string} queryText
 * @param {number} [k=5]
 * @param {{ embed?: (t:string)=>number[], env?: Record<string,string> }} [opts]
 * @returns {Array<{id, source, date, snippet, score}>}
 */
export function rank(index, queryText, k = 5, opts = {}) {
  if (!index || !Array.isArray(index.vectors) || index.vectors.length === 0) return [];
  const embed = index.mode === 'embedding' ? resolveEmbedder(opts) : null;
  if (index.mode === 'embedding' && typeof embed !== 'function') {
    // index was built with embeddings but no embedder available now → cannot vectorize query.
    return [];
  }
  const qv = vectorizeQuery(index, queryText, embed);
  const sim = index.mode === 'embedding' ? cosineDense : cosineSparse;

  const scored = index.vectors.map((vec, i) => ({
    ...index.docs[i],
    score: sim(qv, vec),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score; // similarity FIRST
    // tie-break: newer date wins (recency only breaks ties).
    const da = a.date ? Date.parse(a.date) : NaN;
    const db = b.date ? Date.parse(b.date) : NaN;
    if (!Number.isNaN(da) && !Number.isNaN(db) && db !== da) return db - da;
    return 0;
  });

  const top = Math.max(0, k | 0) || scored.length;
  return scored.slice(0, top);
}

/**
 * Compose an active CARD into a single query string (title + description + ISC). This is the bridge
 * that lets the loop ask "what WARM/COLD memory is relevant to THIS card" (ISC-2). ISC can be an
 * array of criteria or a string; both flatten into the query text.
 * @param {{ id?:string, title?:string, description?:string, isc?: string|string[] }} card
 * @returns {string}
 */
export function cardToQuery(card = {}) {
  const isc = Array.isArray(card.isc) ? card.isc.join(' ') : (card.isc || '');
  return [card.title || '', card.description || '', isc].filter(Boolean).join('\n').trim();
}

/** Convenience: rank by an active card (ISC-2). Equivalent to rank(index, cardToQuery(card), k). */
export function rankByCard(index, card, k = 5, opts = {}) {
  return rank(index, cardToQuery(card), k, opts);
}

// ── Corpus loading (FILE/API I/O — only used by the CLI; tests inject docs instead) ───────────────

/**
 * Parse the global lessons markdown into docs. Lessons are split on level-2 headings (`## Title`);
 * each section becomes one doc. A heading-less file yields a single doc. This is a best-effort
 * parser — corpus loading must never throw; an unreadable file yields [].
 * @returns {Array<{id,text,source,date}>}
 */
export function loadLessonsMd(vldrHome, fs = { readFileSync, existsSync }) {
  const file = join(vldrHome, 'global', 'lessons.md');
  if (!fs.existsSync(file)) return [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const docs = [];
  const sections = raw.split(/^##\s+/m);
  let i = 0;
  for (const sec of sections) {
    const body = sec.trim();
    if (!body || /^#\s/.test(body)) continue; // skip the top-level "# Global Lessons" preamble
    const firstLine = body.split('\n')[0].trim();
    docs.push({ id: `lesson:${i++}`, text: body, source: 'lesson', date: null, title: firstLine });
  }
  return docs;
}

/**
 * Parse community lessons seed.json (array of {title, content, stack, source}) into docs. Optional.
 * @returns {Array<{id,text,source,date}>}
 */
export function loadLessonsSeed(repoRoot, fs = { readFileSync, existsSync }) {
  const file = join(repoRoot, 'framework', 'lessons', 'seed.json');
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.map((l, i) => ({
      id: `seed:${i}`,
      text: [l.title, l.content, l.stack].filter(Boolean).join('\n'),
      source: 'lesson-seed',
      date: null,
      title: l.title || `seed ${i}`,
    }));
  } catch { return []; }
}

/** Read every `*.md` under VLDR_HOME/global/patterns/ as one doc each. */
export function loadPatterns(vldrHome, fs = { readFileSync, existsSync, readdirSync }) {
  const dir = join(vldrHome, 'global', 'patterns');
  if (!fs.existsSync(dir)) return [];
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return []; }
  const docs = [];
  for (const name of names) {
    try {
      const text = fs.readFileSync(join(dir, name), 'utf8').trim();
      if (text) docs.push({ id: `pattern:${name}`, text, source: 'pattern', date: null, title: basename(name, '.md') });
    } catch { /* skip unreadable */ }
  }
  return docs;
}

/**
 * OPTIONAL journal loading via the dashboard API. NOT hard-depended on — any failure (API down,
 * non-200, parse error) yields []. Uses global fetch (Node 18+). `fetchImpl` is injectable for tests.
 * @param {string} projectId
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, limit?: number }} [opts]
 * @returns {Promise<Array<{id,text,source,date}>>}
 */
export async function loadJournal(projectId, opts = {}) {
  if (!projectId) return [];
  const baseUrl = opts.baseUrl || 'http://localhost:3141';
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return [];
  const limit = opts.limit || 200;
  try {
    const res = await fetchImpl(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/journal?limit=${limit}`);
    if (!res || !res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((j) => ({
      id: `journal:${j.id}`,
      text: String(j.entry || ''),
      source: 'journal',
      date: j.timestamp || null,
    })).filter((d) => d.text);
  } catch { return []; }
}

/**
 * Assemble the full corpus from all available file/API sources. Best-effort and never throws;
 * missing sources simply contribute nothing. The CLI calls this; tests do NOT (they inject docs).
 * @param {{ vldrHome?: string, repoRoot?: string, projectId?: string, journal?: boolean,
 *           baseUrl?: string, fetchImpl?: typeof fetch, includeSeed?: boolean }} [opts]
 * @returns {Promise<Array<{id,text,source,date}>>}
 */
export async function loadCorpus(opts = {}) {
  const vldrHome = opts.vldrHome || resolveVldrHome();
  const docs = [];
  docs.push(...loadLessonsMd(vldrHome));
  if (opts.includeSeed && opts.repoRoot) docs.push(...loadLessonsSeed(opts.repoRoot));
  docs.push(...loadPatterns(vldrHome));
  if (opts.journal && opts.projectId) docs.push(...await loadJournal(opts.projectId, opts));
  return docs;
}

// ── Index cache (CLI only) ───────────────────────────────────────────────────────────────────────

/** Path to the on-disk index cache under VLDR_HOME/global. */
export function indexCachePath(vldrHome) {
  return join(vldrHome, 'global', '.retrieval-index.json');
}

/** Serialize an index to a JSON-safe shape (sparse Map vectors → arrays of [term, weight]). */
export function serializeIndex(index) {
  return {
    ...index,
    vectors: index.mode === 'embedding' ? index.vectors : index.vectors.map((m) => Array.from(m.entries())),
  };
}

/** Persist the index to VLDR_HOME/global/.retrieval-index.json (creates the dir if needed). */
export function saveIndex(vldrHome, index) {
  const dir = join(vldrHome, 'global');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(indexCachePath(vldrHome), JSON.stringify(serializeIndex(index)), 'utf8');
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

/** Parse argv into { query, k, cardId, project, json, help }. */
export function parseArgs(argv) {
  const out = { query: '', k: 5, cardId: null, project: null, json: false, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--k') out.k = parseInt(argv[++i], 10) || 5;
    else if (a === '--card') out.cardId = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

const HELP = `semantic-retrieval — similarity-ranked retrieval over lessons/journal/patterns (FRW-BL-058)

Usage:
  node scripts/semantic-retrieval.mjs "what did we learn about X" [--k N] [--card <id>] [--project <id>] [--json]

Options:
  --k N         number of results (default 5)
  --card <id>   rank by an active card's title+description+ISC instead of a free-text query
  --project <id> also pull journal entries from the dashboard API (optional; degrades silently)
  --json        emit JSON instead of human-readable lines
  -h, --help    this help

Embeddings (optional, OFF by default): set VLDR_EMBED_CMD to a command that reads text on stdin and
prints a JSON number[] on stdout. Absent/failing → zero-dependency TF-IDF fallback.`;

/** CLI entry. Loads corpus, builds + caches index, ranks, prints. Returns an exit code. */
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return 0; }

  const vldrHome = resolveVldrHome();
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  const docs = await loadCorpus({
    vldrHome,
    repoRoot,
    includeSeed: true,
    journal: Boolean(args.project),
    projectId: args.project,
  });

  if (docs.length === 0) {
    console.error('No corpus found. Looked for:');
    console.error(`  - ${join(vldrHome, 'global', 'lessons.md')}`);
    console.error(`  - ${join(vldrHome, 'global', 'patterns', '*.md')}`);
    console.error(`  - ${join(repoRoot, 'framework', 'lessons', 'seed.json')}`);
    if (args.project) console.error(`  - dashboard journal for project "${args.project}" (API may be down)`);
    console.error('Add lessons/patterns or pass --project, then retry.');
    return 1;
  }

  const index = buildIndex(docs);
  try { saveIndex(vldrHome, index); } catch { /* cache is best-effort */ }

  // Resolve the query: --card builds the query from a card if its text is supplied, else uses the id
  // as the query (so `--card frw-bl-058` still does something useful even without card storage here).
  let query = args.query;
  if (args.cardId && !query) query = args.cardId;
  if (!query) { console.error('Provide a query string or --card <id>.'); return 1; }

  const results = rank(index, query, args.k);
  if (args.json) { console.log(JSON.stringify(results, null, 2)); return 0; }

  if (results.length === 0 || results.every((r) => r.score === 0)) {
    console.log(`No relevant matches for: "${query}" (corpus: ${docs.length} docs, mode: ${index.mode})`);
    return 0;
  }

  console.log(`Top ${results.filter((r) => r.score > 0).length} match(es) for "${query}"  [mode: ${index.mode}, corpus: ${docs.length} docs]\n`);
  for (const r of results) {
    if (r.score === 0) continue;
    const date = r.date ? ` ${r.date}` : '';
    console.log(`  [${r.score.toFixed(4)}] (${r.source})${date}`);
    console.log(`    ${r.snippet}`);
  }
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    console.error('semantic-retrieval error:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
