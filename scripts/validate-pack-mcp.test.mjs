// Self-test for validate-pack-mcp.mjs (FRW-BL-035). Run: node scripts/validate-pack-mcp.test.mjs
import {
  validateConfig,
  isFullPlaceholder,
  malformedPlaceholders,
  secretLiterals,
  externalRefs,
  findPackMcpFiles,
  ALLOWED_TOP_KEYS,
  EXTERNAL_REF_KEYS,
} from './validate-pack-mcp.mjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('validate-pack-mcp self-test\n');

// ---- isFullPlaceholder ----
ok('isFullPlaceholder: ${FOO} true', isFullPlaceholder('${FOO}'));
ok('isFullPlaceholder: ${CLAUDE_PROJECT_DIR} true', isFullPlaceholder('${CLAUDE_PROJECT_DIR}'));
ok('isFullPlaceholder: trims whitespace', isFullPlaceholder('  ${FOO}  '));
ok('isFullPlaceholder: literal false', !isFullPlaceholder('sk-abc123'));
ok('isFullPlaceholder: embedded not full', !isFullPlaceholder('prefix-${FOO}'));
ok('isFullPlaceholder: lowercase false', !isFullPlaceholder('${foo}'));

// ---- malformedPlaceholders ----
ok('well-formed ${FOO} → no findings', malformedPlaceholders('${FOO}').length === 0);
ok('well-formed embedded path → none', malformedPlaceholders('${CLAUDE_PROJECT_DIR}/server.js').length === 0);
ok('bare $FOO flagged', malformedPlaceholders('$FOO').includes('$FOO'));
ok('unterminated ${FOO flagged', malformedPlaceholders('${FOO').some((b) => b.startsWith('${FOO')));
ok('lowercase ${foo} flagged', malformedPlaceholders('${foo}').includes('${foo}'));
ok('plain string → none', malformedPlaceholders('npx').length === 0);

// ---- secretLiterals ----
ok('token literal flagged', secretLiterals({ env: { API_TOKEN: 'abc123' } }, 'srv').length === 1);
ok('token placeholder OK', secretLiterals({ env: { API_TOKEN: '${API_TOKEN}' } }, 'srv').length === 0);
ok('password literal flagged', secretLiterals({ password: 'hunter2' }).length === 1);
ok('non-secret literal ignored', secretLiterals({ command: 'npx', description: 'hello' }).length === 0);
ok('client_secret literal flagged', secretLiterals({ client_secret: 'xyz' }).length === 1);

// ---- externalRefs ----
for (const k of EXTERNAL_REF_KEYS) {
  ok(`externalRefs flags "${k}"`, externalRefs({ [k]: 'other.json' }).length === 1);
}
ok('externalRefs: clean config → none', externalRefs({ mcpServers: { a: { command: 'npx' } } }).length === 0);
ok('externalRefs: nested $ref flagged', externalRefs({ mcpServers: { a: { $ref: 'x' } } }).length === 1);

// ---- validateConfig: VALID fixture ----
const valid = {
  $schema: 'https://json.schemastore.org/mcp.json',
  mcpServers: {
    playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'], alwaysLoad: true },
    atlassian: { url: 'https://mcp.atlassian.com/v1/sse', env: { ATLASSIAN_API_TOKEN: '${ATLASSIAN_API_TOKEN}' } },
    cotest: { command: 'node', args: ['${CLAUDE_PROJECT_DIR}/srv.js'] },
  },
};
const rv = validateConfig(valid, 'valid');
ok('valid config: ok=true', rv.ok === true);
ok('valid config: no errors', rv.errors.length === 0);
ok('valid config: 3 servers', rv.servers.length === 3);
ok('valid config: playwright is alwaysLoad', rv.servers.find((s) => s.name === 'playwright').alwaysLoad === true);
ok('valid config: atlassian not alwaysLoad', rv.servers.find((s) => s.name === 'atlassian').alwaysLoad === false);

// valid as raw string too
ok('valid config parses from string', validateConfig(JSON.stringify(valid), 'valid-str').ok === true);

// ---- validateConfig: INVALID shapes (each one) ----
// 1. invalid JSON
ok('invalid JSON → not ok', validateConfig('{ not json', 'badjson').ok === false);

// 2. missing mcpServers
ok('missing mcpServers → not ok', validateConfig({ $schema: 'x' }, 'nomcp').errors.some((e) => /mcpServers/.test(e)));

// 3. mcpServers not an object
ok('mcpServers array → not ok', validateConfig({ mcpServers: [] }, 'arr').ok === false);

// 4. root not an object
ok('root array → not ok', validateConfig([], 'rootarr').ok === false);

// 5. secret literal
const secret = { mcpServers: { a: { command: 'npx', env: { API_TOKEN: 'sk-live-xyz' } } } };
ok('secret literal → flagged', validateConfig(secret, 'secret').errors.some((e) => /secret literal/.test(e)));

// 6. malformed placeholder
const badph = { mcpServers: { a: { command: 'npx', args: ['$CLAUDE_PROJECT_DIR/x'] } } };
ok('malformed placeholder → flagged', validateConfig(badph, 'badph').errors.some((e) => /malformed placeholder/.test(e)));

// 7. external ref (breaks strict-mcp-config)
const extref = { mcpServers: { a: { command: 'npx' } }, extends: './base.mcp.json' };
ok('external ref → flagged', validateConfig(extref, 'extref').errors.some((e) => /self-containment/.test(e)));

// 8. disallowed top-level key
const badtop = { mcpServers: { a: { command: 'npx' } }, foo: 1 };
ok('disallowed top key → flagged', validateConfig(badtop, 'badtop').errors.some((e) => /disallowed top-level key/.test(e)));

// 9. server missing command/url
const notransport = { mcpServers: { a: { args: ['x'] } } };
ok('server without command/url → flagged', validateConfig(notransport, 'notransport').errors.some((e) => /command.*url/.test(e)));

// 10. server entry not an object
ok('server entry string → flagged', validateConfig({ mcpServers: { a: 'nope' } }, 'badentry').errors.some((e) => /must be an object/.test(e)));

// ---- findPackMcpFiles + real committed templates ----
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = findPackMcpFiles(repo);
ok('findPackMcpFiles: finds committed templates', files.length >= 4);
let allReal = true; const realAlways = [];
for (const f of files) {
  const r = validateConfig(readFileSync(f, 'utf8'), f);
  if (!r.ok) { allReal = false; console.log(`    real-config ERRORS in ${f}:`, r.errors); }
  realAlways.push(...r.servers.filter((s) => s.alwaysLoad).map((s) => s.name));
}
ok('every committed .mcp.json validates', allReal);
ok('committed templates declare alwaysLoad server(s)', realAlways.length >= 1);
ok('ALLOWED_TOP_KEYS includes mcpServers + $schema', ALLOWED_TOP_KEYS.has('mcpServers') && ALLOWED_TOP_KEYS.has('$schema'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
