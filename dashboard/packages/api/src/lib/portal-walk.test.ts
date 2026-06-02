import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { IscCriterion } from '@vldr/shared';
import { scanPortalAssertions, extractExports } from './portal-walk.js';

// Build a Next.js App Router fixture on disk:
//   <root>/app/dashboard/page.tsx     — full page, exports default + metadata
//   <root>/app/tenants/[id]/page.tsx  — full page, exports default
//   <root>/app/stub/page.tsx          — 2-line stub (no real content)
//   <root>/src/app/reports/page.tsx   — full page under src/app (alt base)
//   <root>/components/Other.tsx       — mentions "/dashboard" in passing (false-positive guard)
let root: string;

// ~28 non-blank lines — a genuinely implemented page, well above minLines 20.
const FULL_PAGE = `import { Suspense } from 'react';

export const metadata = { title: 'Dashboard' };

function Header() {
  return <header><h1>Dashboard</h1></header>;
}

function Footer() {
  return <footer>© Volundr</footer>;
}

export default function DashboardPage() {
  // a genuinely implemented page with real content
  const items = [1, 2, 3, 4, 5];
  const doubled = items.map((i) => i * 2);
  const total = doubled.reduce((a, b) => a + b, 0);
  return (
    <main>
      <Header />
      <p>Total: {total}</p>
      <ul>
        {items.map((i) => (
          <li key={i}>Row {i}</li>
        ))}
      </ul>
      <Footer />
    </main>
  );
}
`;

// ~26 non-blank lines — comfortably above the default minLines of 20.
const TENANT_PAGE = `import { use } from 'react';

export default function TenantPage({ params }) {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
  const f = 6;
  const g = 7;
  const h = 8;
  const i = 9;
  const j = 10;
  const k = 11;
  const l = 12;
  const m = 13;
  const total = a + b + c + d + e + f + g + h + i + j + k + l + m;
  return (
    <section>
      <h1>Tenant {params.id}</h1>
      <p>Total: {total}</p>
    </section>
  );
}
`;

const STUB_PAGE = `export default function Stub() { return null; }
`;

const REPORTS_PAGE = FULL_PAGE.replace('DashboardPage', 'ReportsPage').replace('Dashboard', 'Reports');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'portal-walk-'));
  const write = (rel: string, content: string) => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  write('app/dashboard/page.tsx', FULL_PAGE);
  write('app/tenants/[id]/page.tsx', TENANT_PAGE);
  write('app/stub/page.tsx', STUB_PAGE);
  write('src/app/reports/page.tsx', REPORTS_PAGE);
  write('components/Other.tsx', `// Links to "/dashboard" and "/tenants/[id]" in passing\nexport const X = 1;\n`);
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

const crit = (route: string, extra: Partial<IscCriterion['portal']> = {}): IscCriterion => ({
  criterion: `Route ${route} is implemented`,
  evidence: null,
  passed: null,
  portal: { route, ...extra },
});

describe('portal-walk scanner (FRW-BL-014C2)', () => {
  it('exports a pure scanPortalAssertions(criteria, projectRoot, options?) returning Finding[]', () => {
    const out = scanPortalAssertions([], root, { cardId: 'X' });
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(0);
  });

  it('stub page below minLines AND missing required export → severity "block"', () => {
    const out = scanPortalAssertions(
      [crit('/stub', { expectedExports: ['metadata'] })],
      root,
      { cardId: 'C1' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('block');
    expect(out[0].cardId).toBe('C1');
    expect(out[0].route).toBe('/stub');
    expect(out[0].detail).toMatch(/missing required export/i);
  });

  it('full page above minLines with all required exports → no finding', () => {
    const out = scanPortalAssertions(
      [crit('/dashboard', { expectedExports: ['default', 'metadata'] })],
      root,
    );
    expect(out).toHaveLength(0);
  });

  it('false-positive guard: a route mentioned in passing in another file does NOT trigger a finding', () => {
    // /dashboard IS implemented (full). The route string also appears in components/Other.tsx.
    // The scanner resolves by path, not by content grep, so still no finding.
    const out = scanPortalAssertions([crit('/dashboard', { expectedExports: ['default'] })], root);
    expect(out).toHaveLength(0);
  });

  it('missing-export on an otherwise-full page → severity "warn"', () => {
    const out = scanPortalAssertions(
      [crit('/tenants/[id]', { expectedExports: ['default', 'generateMetadata'] })],
      root,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warn');
    expect(out[0].detail).toMatch(/generateMetadata/);
  });

  it('malformed route → reported as warn, never throws', () => {
    const out = scanPortalAssertions(
      [crit('tenants-no-leading-slash'), crit('')],
      root,
    );
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.severity === 'warn')).toBe(true);
    expect(out[0].detail).toMatch(/malformed/i);
  });

  it('per-criterion minLines override is respected', () => {
    // /tenants/[id] is ~26 non-blank lines. Default min 20 does NOT flag it on length,
    // but raising the per-criterion override to 50 makes it a stub.
    const high = scanPortalAssertions([crit('/tenants/[id]', { minLines: 50 })], root);
    expect(high).toHaveLength(1);
    expect(high[0].severity).toBe('block');

    // Lowering the override below the file's line count keeps it clean.
    const low = scanPortalAssertions([crit('/tenants/[id]', { minLines: 3 })], root);
    expect(low).toHaveLength(0);
  });

  it('resolves pages under the src/app base (Next.js App Router fixture)', () => {
    const out = scanPortalAssertions([crit('/reports', { expectedExports: ['default'] })], root);
    expect(out).toHaveLength(0); // found under src/app, full, has default export
  });

  it('unimplemented route (no file) → severity "block"', () => {
    const out = scanPortalAssertions([crit('/does/not/exist')], root);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('block');
    expect(out[0].detail).toMatch(/no component file/i);
  });

  it('criteria without a portal annotation are skipped entirely', () => {
    const plain: IscCriterion = { criterion: 'backend only', evidence: null, passed: null };
    expect(scanPortalAssertions([plain], root)).toHaveLength(0);
  });
});

describe('extractExports', () => {
  it('detects default, named decls, and brace re-exports with aliases', () => {
    const src = `
      export default function Page() {}
      export const metadata = {};
      export async function generateMetadata() {}
      export class Widget {}
      const internal = 1;
      export { internal as publicName };
      export type Props = {};
    `;
    const ex = extractExports(src);
    expect(ex.has('default')).toBe(true);
    expect(ex.has('metadata')).toBe(true);
    expect(ex.has('generateMetadata')).toBe(true);
    expect(ex.has('Widget')).toBe(true);
    expect(ex.has('publicName')).toBe(true);
    expect(ex.has('Props')).toBe(true);
    expect(ex.has('internal')).toBe(false);
  });
});
