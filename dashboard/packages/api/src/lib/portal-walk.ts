/**
 * portal-walk.ts — Gate 3 portal-walk scanner (FRW-BL-014C2)
 *
 * PURE function: given portal-annotated ISC criteria + a project root, return a
 * list of findings about stub/incomplete UI pages. No DB access, no API calls,
 * no tsc invocation — a lightweight regex/path scan only. The PATCH integration
 * (warn-only) is a separate card (014C3).
 *
 * A "stub page" is a route whose component file is missing, too short, or missing
 * required exports. The scanner infers the file path from the route using a
 * routing convention (Next.js App Router by default) — it does NOT grep the
 * codebase for the route string, so a route merely *mentioned* in another file
 * never produces a false finding.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { IscCriterion } from '@vldr/shared';

export type PortalSeverity = 'block' | 'warn' | 'info';

export interface PortalFinding {
  cardId: string;
  criterion: string;
  route: string;
  severity: PortalSeverity;
  detail: string;
}

export interface PortalWalkOptions {
  /** Card the criteria belong to — stamped onto every finding. */
  cardId?: string;
  /** Default minimum non-blank line count for a route's component file. Default 20. */
  minLines?: number;
  /** Routing convention used to infer a file path from a route. Default 'next-app-router'. */
  routeConvention?: 'next-app-router';
}

const DEFAULT_MIN_LINES = 20;

/** Base directories a Next.js App Router project may keep its `app/` tree under. */
const NEXT_APP_BASES = ['app', 'src/app'];
/** Page component filenames, in resolution order. */
const NEXT_PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

/**
 * Resolve the candidate component file for a route under the Next.js App Router
 * convention. Returns the first existing file, or null if none exist.
 */
function resolveNextAppRouterFile(projectRoot: string, route: string): string | null {
  const segments = route.split('/').filter(Boolean); // "/" -> [], "/a/[id]" -> ['a','[id]']
  for (const base of NEXT_APP_BASES) {
    for (const pageFile of NEXT_PAGE_FILES) {
      const candidate = join(projectRoot, base, ...segments, pageFile);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Count non-blank lines — a 3-line stub shouldn't read as a full page. */
function countNonBlankLines(source: string): number {
  return source.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

/**
 * Extract the set of exported symbol names from TS/JS source via a lightweight
 * regex surface scan (no tsc). `export default ...` contributes the name 'default'.
 */
export function extractExports(source: string): Set<string> {
  const names = new Set<string>();

  if (/\bexport\s+default\b/.test(source)) names.add('default');

  // export const/let/var/function/class/async function/interface/type/enum NAME
  const declRe =
    /\bexport\s+(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(source)) !== null) names.add(m[1]);

  // export { A, B as C, default as D }
  const braceRe = /\bexport\s*\{([^}]*)\}/g;
  while ((m = braceRe.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const asMatch = seg.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : seg.split(/\s+/)[0];
      if (name) names.add(name);
    }
  }

  return names;
}

/**
 * Scan portal-annotated ISC criteria for stub pages. Pure: same inputs → same
 * findings. Criteria without a `portal` annotation are skipped.
 */
export function scanPortalAssertions(
  criteria: IscCriterion[],
  projectRoot: string,
  options: PortalWalkOptions = {},
): PortalFinding[] {
  const cardId = options.cardId ?? '';
  const defaultMinLines = options.minLines ?? DEFAULT_MIN_LINES;
  const findings: PortalFinding[] = [];

  for (const c of criteria) {
    if (!c.portal) continue; // non-UI criterion — no portal cost
    const route = c.portal.route;

    // Malformed route — report, never throw.
    if (!route || typeof route !== 'string' || !route.startsWith('/')) {
      findings.push({
        cardId,
        criterion: c.criterion,
        route: typeof route === 'string' ? route : '',
        severity: 'warn',
        detail: `Malformed portal route ${JSON.stringify(route)} — expected a path beginning with "/".`,
      });
      continue;
    }

    const minLines = c.portal.minLines ?? defaultMinLines;
    const expectedExports = c.portal.expectedExports ?? [];

    const file = resolveNextAppRouterFile(projectRoot, route);
    if (!file) {
      findings.push({
        cardId,
        criterion: c.criterion,
        route,
        severity: 'block',
        detail: `No component file found for route "${route}" (looked for ${NEXT_PAGE_FILES.join('/')} under ${NEXT_APP_BASES.join(', ')}). Route is unimplemented.`,
      });
      continue;
    }

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (e) {
      findings.push({
        cardId,
        criterion: c.criterion,
        route,
        severity: 'block',
        detail: `Component file for "${route}" could not be read: ${(e as Error).message}`,
      });
      continue;
    }

    const lineCount = countNonBlankLines(source);
    const exportNames = extractExports(source);
    const missingExports = expectedExports.filter((name) => !exportNames.has(name));

    const tooShort = lineCount < minLines;
    const missing = missingExports.length > 0;

    // Severity matrix:
    //   too short  + missing exports  -> block (clear stub)
    //   too short  + exports ok       -> block (stub page; too little content to be real)
    //   full       + missing exports  -> warn  (has content but missing required API surface)
    //   full       + exports ok       -> no finding
    if (tooShort) {
      const exportNote = missing ? ` and missing required export(s): ${missingExports.join(', ')}` : '';
      findings.push({
        cardId,
        criterion: c.criterion,
        route,
        severity: 'block',
        detail: `Stub page for "${route}": ${lineCount} non-blank line(s) < minLines ${minLines}${exportNote}.`,
      });
      continue;
    }

    if (missing) {
      findings.push({
        cardId,
        criterion: c.criterion,
        route,
        severity: 'warn',
        detail: `Page for "${route}" is present (${lineCount} lines) but missing required export(s): ${missingExports.join(', ')}.`,
      });
      continue;
    }

    // Full page with all required exports — clean, no finding.
  }

  return findings;
}
