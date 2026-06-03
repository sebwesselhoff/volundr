#!/usr/bin/env node
/**
 * workspace-index.mjs — shared, topic-indexed "file-as-memory" workspace (FRW-BL-065)
 *
 * PROBLEM: teammates working overlapping areas duplicate effort because findings
 * live only in each agent's private context. When a finding is large, pasting it
 * into a SendMessage also bloats the conversation.
 *
 * SOLUTION: a per-project shared workspace directory where findings are written to
 * topic-indexed files. Peers READ the relevant topic file(s) before starting
 * overlapping work, and large findings are externalized to a file and referenced
 * by PATH in messages rather than pasted inline.
 *
 * WORKSPACE PATH CONVENTION: `<projectRoot>/.vldr-workspace/`
 *   - chosen as a dot-prefixed dir so it is co-located with the project but visually
 *     out of the way (like .git / .vscode), and easy to .gitignore if desired.
 *   - one markdown file per topic: `<wsDir>/<slug>.md` (human-readable, appendable,
 *     and renders in the dashboard / editors without a viewer).
 *   - an `index.json` maps topic -> { file, count, updated } so peers can discover
 *     which topics exist without scanning the directory.
 *
 * Pure Node ESM, NO external deps (bare `node`, no tsc/npx). Exported functions are
 * pure where possible; the I/O helpers create the workspace dir on demand.
 *
 * USAGE (programmatic):
 *   import { workspaceDir, writeFinding, readFindings } from './workspace-index.mjs';
 *   const ws = workspaceDir(process.cwd());
 *   writeFinding(ws, 'auth-token-refresh', 'JWT refresh races on concurrent calls');
 *   const all = readFindings(ws, 'auth-token-refresh');
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/** Default char threshold above which a finding should be externalized to a file. */
export const EXTERNALIZE_THRESHOLD = 1500;

/** Name of the topic->file index inside the workspace dir. */
export const INDEX_FILE = 'index.json';

/** Workspace directory name relative to a project root. */
export const WORKSPACE_DIRNAME = '.vldr-workspace';

/**
 * Convert an arbitrary topic string into a deterministic, filesystem-safe slug.
 * Lowercased; non-alphanumerics collapse to single hyphens; trimmed of edge hyphens.
 * Falls back to "untitled" for empty/symbol-only input so a path is always produced.
 *
 * NOTE: the slug alone is NOT collision-safe — "API: v1" and "api v1" both produce
 * "api-v1". Use {@link topicKey} (slug + hash6) as the stable, unique identifier
 * for a topic, and {@link topicFile} for the corresponding file path.
 * @param {string} topic
 * @returns {string} filesystem-safe slug (no uniqueness guarantee across distinct topics)
 */
export function slugifyTopic(topic) {
  const slug = String(topic ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/**
 * Produce a collision-safe key for a topic: `<slug>-<hash6>` where hash6 is the
 * first 6 hex chars of the SHA-256 of the raw (pre-slugify) topic string. Two topics
 * that produce the same slug but differ in their original text will get different keys
 * and therefore different files — "API: v1" and "api v1" are permanently distinct.
 * @param {string} topic
 * @returns {string} collision-safe key, e.g. `api-v1-3f9a2c`
 */
export function topicKey(topic) {
  const raw = String(topic ?? '');
  const hash6 = createHash('sha256').update(raw).digest('hex').slice(0, 6);
  return `${slugifyTopic(raw)}-${hash6}`;
}

/**
 * The shared workspace path convention for a given project root.
 * @param {string} projectRoot absolute or relative project root
 * @returns {string} `<projectRoot>/.vldr-workspace`
 */
export function workspaceDir(projectRoot) {
  return join(projectRoot, WORKSPACE_DIRNAME);
}

/**
 * Deterministic, collision-safe path to the markdown file backing a topic.
 * Uses `<slug>-<hash6>.md` so that semantically distinct topics that share a slug
 * (e.g. "API: v1" vs "api v1") map to different files and never silently merge.
 * @param {string} wsDir workspace directory (from {@link workspaceDir})
 * @param {string} topic
 * @returns {string} `<wsDir>/<slug>-<hash6>.md`
 */
export function topicFile(wsDir, topic) {
  return join(wsDir, `${topicKey(topic)}.md`);
}

/** Ensure the workspace dir exists (idempotent). @param {string} wsDir */
function ensureDir(wsDir) {
  if (!existsSync(wsDir)) mkdirSync(wsDir, { recursive: true });
}

/**
 * Append a finding to a topic file (creating the dir/file if missing) and update
 * the index. Each finding is written as a markdown section with a UTC timestamp so
 * appended findings stay distinct and ordered.
 * @param {string} wsDir
 * @param {string} topic
 * @param {string} finding free-text finding
 * @returns {string} the topic file path written to
 */
export function writeFinding(wsDir, topic, finding) {
  ensureDir(wsDir);
  const file = topicFile(wsDir, topic);
  const ts = new Date().toISOString();
  const block = `## ${ts}\n\n${String(finding ?? '').trim()}\n\n`;
  if (existsSync(file)) appendFileSync(file, block, 'utf8');
  else writeFileSync(file, `# Topic: ${topic}\n\n${block}`, 'utf8');
  updateIndex(wsDir, topic);
  return file;
}

/**
 * Read the raw markdown body of a topic's findings.
 * @param {string} wsDir
 * @param {string} topic
 * @returns {string} file contents, or '' if the topic has no findings yet
 */
export function readFindings(wsDir, topic) {
  const file = topicFile(wsDir, topic);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

/**
 * Read the topic index. Returns {} if it does not exist or is unreadable.
 * @param {string} wsDir
 * @returns {Record<string, {file: string, count: number, updated: string}>}
 */
export function readIndex(wsDir) {
  const idxPath = join(wsDir, INDEX_FILE);
  if (!existsSync(idxPath)) return {};
  try {
    return JSON.parse(readFileSync(idxPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Record/refresh a topic in the index: bump its finding count and updated time,
 * pointing at the collision-safe `<slug>-<hash6>.md` file. Creates the dir/index on
 * demand. The index key is the stable {@link topicKey} so two topics that share a slug
 * but differ in original text have distinct entries and their collision is visible.
 * @param {string} wsDir
 * @param {string} topic
 * @returns {Record<string, {topic: string, file: string, count: number, updated: string}>}
 */
export function updateIndex(wsDir, topic) {
  ensureDir(wsDir);
  const idx = readIndex(wsDir);
  const key = topicKey(topic);
  const prev = idx[key];
  idx[key] = {
    topic,
    file: `${key}.md`,
    count: (prev?.count ?? 0) + 1,
    updated: new Date().toISOString(),
  };
  writeFileSync(join(wsDir, INDEX_FILE), `${JSON.stringify(idx, null, 2)}\n`, 'utf8');
  return idx;
}

/**
 * Decide whether a finding is large enough that it should be externalized to a
 * topic file and referenced by PATH in a message, rather than pasted inline.
 * Boundary is strict: length === threshold is NOT externalized; length > threshold is.
 * @param {string} text
 * @param {number} [threshold=EXTERNALIZE_THRESHOLD]
 * @returns {boolean}
 */
export function shouldExternalize(text, threshold = EXTERNALIZE_THRESHOLD) {
  return String(text ?? '').length > threshold;
}
