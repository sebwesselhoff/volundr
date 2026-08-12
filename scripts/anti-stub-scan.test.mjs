// anti-stub-scan.test.mjs — self-test (FRW-BL-044). Run: node scripts/anti-stub-scan.test.mjs
import assert from 'assert';
import { scanForStubs, isTestFile, isOwnSource, splitCardArg } from './anti-stub-scan.mjs';

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

// --- FRW-BL-103: the scanner must not scan itself ---------------------------
// Found live: staging any change to anti-stub-scan.mjs produced 5 BLOCKs against its OWN pattern
// table (which necessarily contains `NotImplementedError`, `panic("not impl`, ...) and exited 2,
// making the tool unmodifiable. Same FRW-BL-090 shape: a definition of a forbidden thing read as
// the forbidden thing.
test('FRW-BL-103: own source is excluded (relative, absolute, and its test)', () => {
  assert.ok(isOwnSource('scripts/anti-stub-scan.mjs'));
  assert.ok(isOwnSource('C:\\repo\\scripts\\anti-stub-scan.mjs'));
  assert.ok(isOwnSource('/home/x/scripts/anti-stub-scan.mjs'));
  assert.ok(isOwnSource('scripts/anti-stub-scan.test.mjs'));
});

test('FRW-BL-103: the exclusion is NARROW — other files are never skipped', () => {
  assert.ok(!isOwnSource('scripts/procedural-order.mjs'));
  assert.ok(!isOwnSource('scripts/garden-lint.mjs'));
  // A file merely NAMED similarly elsewhere must still be scanned.
  assert.ok(!isOwnSource('src/anti-stub-scanner-helper.mjs'));
  assert.ok(!isOwnSource(''));
  assert.ok(!isOwnSource(undefined));
});

// --- FRW-BL-103: the --card off-by-one that silently ate --staged ------------
test('FRW-BL-103 REGRESSION: with no --card, argv is passed through untouched', () => {
  // The bug: cardIdx === -1 made `i !== cardIdx + 1` mean `i !== 0`, dropping argv[0], so a bare
  // `--staged` resolved to zero files and exited 0 — a green that scanned nothing.
  const { cardId, rest } = splitCardArg(['--staged']);
  assert.strictEqual(cardId, null);
  assert.deepStrictEqual(rest, ['--staged'], 'the --staged flag must survive');
});

test('FRW-BL-103: --card is stripped with its value, leaving other flags intact', () => {
  const { cardId, rest } = splitCardArg(['--staged', '--card', 'FRW-BL-103']);
  assert.strictEqual(cardId, 'FRW-BL-103');
  assert.deepStrictEqual(rest, ['--staged']);
});

test('FRW-BL-103: --card first still leaves the trailing flags intact', () => {
  const { cardId, rest } = splitCardArg(['--card', 'FRW-BL-103', '--diff', 'main...x']);
  assert.strictEqual(cardId, 'FRW-BL-103');
  assert.deepStrictEqual(rest, ['--diff', 'main...x']);
});

test('FRW-BL-103: a trailing --card with no value does not throw or eat a flag', () => {
  const { cardId, rest } = splitCardArg(['--staged', '--card']);
  assert.strictEqual(cardId, null);
  assert.deepStrictEqual(rest, ['--staged']);
});

test('FRW-BL-103: junk argv is tolerated', () => {
  assert.deepStrictEqual(splitCardArg(null), { cardId: null, rest: [] });
  assert.deepStrictEqual(splitCardArg([]), { cardId: null, rest: [] });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
