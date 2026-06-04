// Self-test for semantic-retrieval.mjs (FRW-BL-058). Run: node scripts/semantic-retrieval.test.mjs
//
// All ranking is exercised against an IN-MEMORY FIXTURE corpus — no real files, no API, no model.
// This is the design contract: core ranking accepts an injected docs[] of {id,text,source,date}.
import {
  tokenize,
  termFrequencies,
  cosineSparse,
  cosineDense,
  buildIndex,
  rank,
  rankByCard,
  cardToQuery,
  resolveEmbedder,
  resolveVldrHome,
  serializeIndex,
  parseArgs,
  loadJournal,
  loadCard,
} from './semantic-retrieval.mjs';

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

console.log('semantic-retrieval self-test\n');

// ── FIXTURE corpus (injected — never touches disk/network) ───────────────────────────────────────
// One lesson is clearly ABOUT "yaml template expressions"; an unrelated doc is about Docker; a third,
// MORE RECENT doc is about an unrelated topic (used to prove relevance beats recency for ISC-2).
const fixture = [
  {
    id: 'L1',
    source: 'lesson',
    date: '2024-01-01',
    text: 'YAML round-trip is dangerous for template expressions. The yaml library mangles template '
        + 'expressions, comments and anchors. Use pure string-level insertion for yaml files with '
        + 'template expressions instead of parse and serialize.',
  },
  {
    id: 'L2',
    source: 'pattern',
    date: '2024-02-01',
    text: 'Docker container caching: pull the latest image and recreate the container only when the '
        + 'digest changed. Bind-mount the sqlite database directory into the docker container.',
  },
  {
    id: 'L3',
    source: 'journal',
    date: '2026-06-01', // MOST RECENT, but topically unrelated to yaml
    text: 'Refactored the dashboard websocket reconnect logic and tuned the heartbeat interval.',
  },
  {
    id: 'L4',
    source: 'lesson',
    date: '2024-03-01',
    text: 'Absolute paths prevent cross-tool confusion. Tools that return file paths should use '
        + 'absolute paths because relative paths cause resolution failures between tools.',
  },
];

// ── tokenizer / tf basics ────────────────────────────────────────────────────────────────────────
ok('tokenize lowercases, splits, drops stop-words ("the","is","for")',
  JSON.stringify(tokenize('The YAML is dangerous for templates')) === JSON.stringify(['yaml', 'dangerous', 'templates']));
ok('tokenize: null/empty → []', tokenize(null).length === 0 && tokenize('').length === 0);
const tf = termFrequencies(tokenize('yaml yaml template'));
ok('termFrequencies counts repeats', tf.get('yaml') === 2 && tf.get('template') === 1);

// ── cosine helpers ───────────────────────────────────────────────────────────────────────────────
ok('cosineSparse: identical maps → 1', Math.abs(cosineSparse(new Map([['a', 1], ['b', 2]]), new Map([['a', 1], ['b', 2]])) - 1) < 1e-9);
ok('cosineSparse: disjoint maps → 0', cosineSparse(new Map([['a', 1]]), new Map([['b', 1]])) === 0);
ok('cosineDense: identical vectors → 1', Math.abs(cosineDense([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
ok('cosineDense: orthogonal → 0', cosineDense([1, 0], [0, 1]) === 0);
ok('cosineDense: dim mismatch → 0 (no throw)', cosineDense([1, 2], [1, 2, 3]) === 0);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ISC-3 + ISC-1: with NO embedder configured, buildIndex/rank work via the TF-IDF fallback, and an
// index IS actually built with per-doc vectors.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n-- ISC-3: zero-dependency TF-IDF fallback (no embedder) --');
// Pass an explicit empty env so VLDR_EMBED_CMD in the real environment can't leak in.
const idx = buildIndex(fixture, { env: {} });
ok('ISC-3: no embedder configured → mode is tfidf (fallback path exercised)', idx.mode === 'tfidf');
ok('ISC-3: resolveEmbedder({env:{}}) === null (no provider)', resolveEmbedder({ env: {} }) === null);

console.log('\n-- ISC-1: an index is actually built with per-doc vectors --');
ok('ISC-1: one vector per doc', Array.isArray(idx.vectors) && idx.vectors.length === fixture.length);
ok('ISC-1: tfidf vectors are non-empty term→weight Maps', idx.vectors.every((v) => v instanceof Map && v.size > 0));
ok('ISC-1: idf table built over the corpus vocabulary', idx.idf && typeof idx.idf['yaml'] === 'number' && idx.idf['yaml'] > 0);
ok('ISC-1: index records corpus size N and per-doc metadata (source/date/snippet)',
  idx.N === fixture.length && idx.docs.length === fixture.length
  && idx.docs[0].source === 'lesson' && idx.docs[0].date === '2024-01-01' && typeof idx.docs[0].snippet === 'string');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ISC-4: a "what did we learn about X" query returns the fixture lesson actually about X on top,
// above an unrelated doc.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n-- ISC-4: "what did we learn about X" returns the relevant lesson on top --');
const r4 = rank(idx, 'what did we learn about yaml template expressions', 4, { env: {} });
ok('ISC-4: top result is the yaml-template lesson (L1)', r4.length > 0 && r4[0].id === 'L1');
ok('ISC-4: top result outscores the unrelated Docker doc (L2)',
  r4[0].score > (r4.find((r) => r.id === 'L2')?.score ?? 0));
ok('ISC-4: top result has a positive similarity score', r4[0].score > 0);
ok('ISC-4: results carry source+date+snippet+score for display',
  r4[0].source && 'date' in r4[0] && typeof r4[0].snippet === 'string' && typeof r4[0].score === 'number');
// A different query about paths returns the paths lesson on top, not yaml — proves it's not fixed.
const rPaths = rank(idx, 'absolute versus relative file paths between tools', 4, { env: {} });
ok('ISC-4: a paths-query returns the paths lesson (L4) on top (query-sensitive, not hard-coded)',
  rPaths.length > 0 && rPaths[0].id === 'L4');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ISC-2: ranking by an ACTIVE CARD selects the topically-matching doc over a recent-but-irrelevant
// one — relevance beats recency.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n-- ISC-2: rank by active card; relevance beats recency --');
const card = {
  id: 'frw-bl-099',
  title: 'Fix YAML template expression serialization',
  description: 'Editing pipeline YAML mangles template expressions on round-trip.',
  isc: ['template expressions survive a yaml edit', 'no parse/serialize of yaml with template expressions'],
};
const q = cardToQuery(card);
ok('ISC-2: cardToQuery composes title+description+ISC', /YAML/i.test(q) && /template expressions/i.test(q) && /survive/i.test(q));
const r2 = rankByCard(idx, card, 4, { env: {} });
// L3 (journal) is the MOST RECENT doc but topically unrelated; the yaml lesson L1 must still win.
ok('ISC-2: active-card ranking puts the on-topic lesson (L1) first', r2[0].id === 'L1');
const l1Score = r2.find((r) => r.id === 'L1').score;
const l3Score = r2.find((r) => r.id === 'L3').score; // most recent doc
ok('ISC-2: on-topic L1 outranks the MORE-RECENT-but-irrelevant L3 (relevance > recency)', l1Score > l3Score);

// Recency only breaks TIES, never overrides a higher score: two docs with the SAME score → newer first.
const tieIdx = {
  mode: 'tfidf',
  docs: [
    { id: 'older', source: 'lesson', date: '2024-01-01', snippet: '' },
    { id: 'newer', source: 'lesson', date: '2026-01-01', snippet: '' },
  ],
  idf: { kafka: 1 },
  vectors: [new Map([['kafka', 1]]), new Map([['kafka', 1]])], // identical → identical score
  dim: null,
  N: 2,
};
const tieRanked = rank(tieIdx, 'kafka', 2, { env: {} });
ok('ISC-2: equal-score tie broken by recency (newer first)', tieRanked[0].id === 'newer' && tieRanked[0].score === tieRanked[1].score);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ISC-1 (embedding branch): exercise the optional embedding path via a FAKE injected embedder fn.
// No real model/network. The fake maps text → a 3-dim "topic" vector by keyword presence so cosine
// is meaningful.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n-- ISC-1: embedding branch via a fake injected embedder --');
function fakeEmbed(text) {
  const t = String(text).toLowerCase();
  // dims: [yaml-ness, docker-ness, paths-ness]
  return [
    (t.includes('yaml') ? 1 : 0) + (t.includes('template') ? 1 : 0),
    (t.includes('docker') ? 1 : 0) + (t.includes('container') ? 1 : 0),
    (t.includes('path') ? 1 : 0) + (t.includes('absolute') ? 1 : 0),
  ];
}
const eIdx = buildIndex(fixture, { embed: fakeEmbed });
ok('ISC-1: with an injected embedder, mode === embedding (optional path taken)', eIdx.mode === 'embedding');
ok('ISC-1: embedding index stores ONE dense number[] per doc with a fixed dim', eIdx.vectors.length === fixture.length && eIdx.dim === 3 && eIdx.vectors.every((v) => Array.isArray(v) && v.length === 3));
const eRanked = rank(eIdx, 'yaml template expressions problem', 4, { embed: fakeEmbed });
ok('ISC-1: embedding-ranked top result is the yaml lesson (L1)', eRanked[0].id === 'L1' && eRanked[0].score > 0);

// resolveEmbedder prefers an injected fn over env.
ok('resolveEmbedder prefers injected embed fn', resolveEmbedder({ embed: fakeEmbed }) === fakeEmbed);
// VLDR_EMBED_CMD presence yields a function (wrapped command); we do NOT execute it here.
ok('resolveEmbedder wraps VLDR_EMBED_CMD into a function', typeof resolveEmbedder({ env: { VLDR_EMBED_CMD: 'cat' } }) === 'function');

// Embedding index built with an embedder, but rank() called WITHOUT one → empty (cannot vectorize query).
ok('embedding index + no embedder at query time → [] (graceful, no throw)', rank(eIdx, 'yaml', 4, { env: {} }).length === 0);

// ── edge cases / robustness ──────────────────────────────────────────────────────────────────────
console.log('\n-- edge cases --');
ok('empty corpus → buildIndex gives N=0, rank → []', (() => { const e = buildIndex([], { env: {} }); return e.N === 0 && rank(e, 'anything').length === 0; })());
ok('null docs → no throw, N=0', buildIndex(null, { env: {} }).N === 0);
ok('docs missing text are skipped', buildIndex([{ id: 'x' }, { id: 'y', text: 'real yaml content' }], { env: {} }).N === 1);
ok('query with only unknown terms → all-zero scores (no false matches)',
  rank(idx, 'zzz qqq wwwwww', 4, { env: {} }).every((r) => r.score === 0));
ok('rank respects k', rank(idx, 'yaml docker paths template', 2, { env: {} }).length === 2);

// ── serialization round-trip (CLI cache shape) ──────────────────────────────────────────────────
const ser = serializeIndex(idx);
ok('serializeIndex turns sparse Map vectors into [term,weight] arrays (JSON-safe)',
  Array.isArray(ser.vectors[0]) && Array.isArray(ser.vectors[0][0]) && typeof JSON.stringify(ser) === 'string');

// ── CLI arg parsing ──────────────────────────────────────────────────────────────────────────────
const a1 = parseArgs(['what', 'did', 'we', 'learn', 'about', 'yaml', '--k', '3']);
ok('parseArgs: free-text query + --k', a1.query === 'what did we learn about yaml' && a1.k === 3);
const a2 = parseArgs(['--card', 'frw-bl-058', '--project', 'volundr-meta', '--json']);
ok('parseArgs: --card/--project/--json flags', a2.cardId === 'frw-bl-058' && a2.project === 'volundr-meta' && a2.json === true);

// ── VLDR_HOME resolution ─────────────────────────────────────────────────────────────────────────
ok('resolveVldrHome honors explicit VLDR_HOME', resolveVldrHome({ VLDR_HOME: '/tmp/vh' }) === '/tmp/vh');
ok('resolveVldrHome falls back to ~/.volundr', resolveVldrHome({}).replace(/\\/g, '/').endsWith('.volundr'));

// ── loadJournal is injectable + degrades gracefully (no real API needed) ──────────────────────────
console.log('\n-- loadJournal (optional, injectable, degrades gracefully) --');
const fakeFetchOk = async () => ({ ok: true, json: async () => ([{ id: 7, entry: 'learned about kafka retention', timestamp: '2026-05-01' }]) });
const jdocs = await loadJournal('volundr-meta', { fetchImpl: fakeFetchOk });
ok('loadJournal: maps API entries → {id,text,source:journal,date}', jdocs.length === 1 && jdocs[0].source === 'journal' && jdocs[0].date === '2026-05-01' && /kafka/.test(jdocs[0].text));
const fakeFetchDown = async () => { throw new Error('ECONNREFUSED'); };
ok('loadJournal: API down → [] (does NOT throw, no hard dependency)', (await loadJournal('p', { fetchImpl: fakeFetchDown })).length === 0);
ok('loadJournal: non-200 → []', (await loadJournal('p', { fetchImpl: async () => ({ ok: false }) })).length === 0);
ok('loadJournal: no projectId → []', (await loadJournal('', { fetchImpl: fakeFetchOk })).length === 0);

// ── loadCard (--card fetch): injectable, normalizes isc objects, degrades gracefully (ISC-2 CLI) ───
console.log('\n-- loadCard (--card fetch, injectable, normalizes isc, degrades gracefully) --');
const fakeCardOk = async () => ({ ok: true, json: async () => ({ id: 'FRW-BL-058', title: 'Semantic retrieval', description: 'rank by similarity', isc: [{ criterion: 'ranks by card', passed: null }, { criterion: 'zero-dep fallback', passed: null }] }) });
const cardFetched = await loadCard('FRW-BL-058', { fetchImpl: fakeCardOk });
ok('loadCard: returns normalized {id,title,description,isc[]}', cardFetched && cardFetched.id === 'FRW-BL-058' && Array.isArray(cardFetched.isc) && cardFetched.isc.length === 2);
ok('loadCard: API isc objects flattened to criterion strings', cardFetched.isc.every((c) => typeof c === 'string') && /ranks by card/.test(cardFetched.isc[0]));
ok('loadCard: feeds cardToQuery (title+description+ISC) for real --card ranking', /Semantic retrieval/.test(cardToQuery(cardFetched)) && /zero-dep fallback/.test(cardToQuery(cardFetched)));
ok('loadCard: API down → null (CLI degrades to id-as-query)', (await loadCard('X', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })) === null);
ok('loadCard: non-200 → null', (await loadCard('X', { fetchImpl: async () => ({ ok: false }) })) === null);
ok('loadCard: error payload → null', (await loadCard('X', { fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'not found' }) }) })) === null);
ok('loadCard: empty id → null', (await loadCard('', { fetchImpl: fakeCardOk })) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
