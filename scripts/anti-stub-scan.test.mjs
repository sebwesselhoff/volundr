// anti-stub-scan.test.mjs — self-test (FRW-BL-044). Run: node scripts/anti-stub-scan.test.mjs
import assert from 'assert';
import { scanForStubs, isTestFile } from './anti-stub-scan.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}

// In-memory file system for the injected readFile
const FILES = {
  'src/clean.ts': `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  'src/stub.ts': `export function compute(): number {\n  throw new Error('not implemented yet');\n}\n`,
  'src/notimpl.cs': `public int Compute() {\n  throw new NotImplementedException();\n}\n`,
  'src/todo.ts': `export function f() {\n  // TODO: handle the edge case\n  return 1;\n}\n`,
  'src/foo.test.ts': `it('mocks', () => {\n  const stub = jest.fn(); // not implemented\n});\n`,
  '__tests__/bar.ts': `export const mock = () => { throw new Error('not implemented'); };\n`,
  'src/fixtures/data.ts': `export const sample = { stub: true };\n`,
};
const read = (p) => { if (!(p in FILES)) throw new Error('no file'); return FILES[p]; };

test('clean production file produces no findings', () => {
  const f = scanForStubs(['src/clean.ts'], read);
  assert.strictEqual(f.length, 0, JSON.stringify(f));
});

test('stub (throw new Error not implemented) -> block', () => {
  const f = scanForStubs(['src/stub.ts'], read);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'block');
  assert.strictEqual(f[0].line, 2);
});

test('NotImplementedException -> block', () => {
  const f = scanForStubs(['src/notimpl.cs'], read);
  assert.ok(f.some((x) => x.severity === 'block' && /NotImplemented/.test(x.label)), JSON.stringify(f));
});

test('TODO comment -> warn (not block)', () => {
  const f = scanForStubs(['src/todo.ts'], read);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'warn');
  assert.strictEqual(f[0].label, 'TODO');
});

test('test files are excluded (.test.ts and __tests__/ and fixtures/)', () => {
  const f = scanForStubs(['src/foo.test.ts', '__tests__/bar.ts', 'src/fixtures/data.ts'], read);
  assert.strictEqual(f.length, 0, `expected test/fixture files skipped, got ${JSON.stringify(f)}`);
});

test('isTestFile recognises common test/fixture paths', () => {
  assert.ok(isTestFile('src/a.test.ts'));
  assert.ok(isTestFile('packages/x/__tests__/y.ts'));
  assert.ok(isTestFile('a/fixtures/b.ts'));
  assert.ok(isTestFile('a/spec/b.ts'));
  assert.ok(!isTestFile('src/service.ts'));
});

test('mixed batch: block from prod file, test file ignored', () => {
  const f = scanForStubs(['src/stub.ts', 'src/foo.test.ts', 'src/clean.ts'], read);
  assert.strictEqual(f.filter((x) => x.severity === 'block').length, 1);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
