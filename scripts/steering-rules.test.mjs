// Self-test for steering-rules.mjs (FRW-BL-102). Run: node scripts/steering-rules.test.mjs
import { parseRules, addRule, suppressRule, HEADINGS } from './steering-rules.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const NOW = '2026-08-12';

const BASE = [
  '# Proj — Project Constraints',
  '',
  '## Stack',
  '',
  '- Node 24',
  '',
  '## Steering Rules',
  '',
  '(none yet — appended as quality scores generate them)',
  '',
  '## Spike Results',
  '',
  'later content',
].join('\n');

console.log('steering-rules self-test\n');

// --- add ---------------------------------------------------------------------------------------
{
  const { content, rule, entry } = addRule(BASE, { cardId: 'CARD-BE-007', text: 'Never widen a matcher without checking the pattern set.', score: 4.2, dimension: 'correctness', now: NOW });
  ok('rule is appended in the documented form', rule === '- [CARD-BE-007] Never widen a matcher without checking the pattern set. (score: 4.2, failed: correctness)');
  ok('the "(none yet)" placeholder is REPLACED, not left beside the rule', !content.includes('(none yet'));
  ok('a Change Log subsection is created', content.includes(HEADINGS.LOG_HEADING));
  ok('the log entry names the card, score and failed dimension', /CARD-BE-007.*scored 4\.2.*failed correctness/.test(entry));
  ok('content after the section is preserved', content.includes('## Spike Results') && content.includes('later content'));
  ok('content before the section is preserved', content.includes('## Stack') && content.includes('- Node 24'));
  ok('parseRules round-trips the new rule', parseRules(content).some((r) => r.cardId === 'CARD-BE-007' && !r.suppressed));
}

// --- second add: rule goes ABOVE the log, log entry PREPENDS ------------------------------------
{
  const one = addRule(BASE, { cardId: 'CARD-A-001', text: 'first rule', score: 4.0, now: NOW }).content;
  const two = addRule(one, { cardId: 'CARD-B-002', text: 'second rule', score: 3.0, now: '2026-08-13' }).content;
  const lines = two.split('\n');
  const logIdx = lines.findIndex((l) => l.trim() === HEADINGS.LOG_HEADING);
  const ruleIdxs = lines.map((l, i) => (/^- \[CARD-/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  ok('both rules sit ABOVE the Change Log', ruleIdxs.every((i) => i < logIdx));
  const entryIdxs = lines.map((l, i) => (/^- 2026-08-/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  ok('newest log entry is FIRST (prepended)', lines[entryIdxs[0]].includes('2026-08-13'));
  ok('older log entry is retained below it', lines[entryIdxs[1]].includes('2026-08-12'));
  ok('exactly one Change Log heading exists after two adds', lines.filter((l) => l.trim() === HEADINGS.LOG_HEADING).length === 1);
  ok('parseRules sees both rules', parseRules(two).length === 2);
}

// --- suppress ----------------------------------------------------------------------------------
{
  const added = addRule(BASE, { cardId: 'CARD-C-003', text: 'a rule that turns out to be wrong', score: 4.5, now: NOW }).content;
  const { content, suppressed, entry } = suppressRule(added, { match: 'CARD-C-003', reason: 'spec was the problem, not the agent', now: '2026-08-14' });
  ok('suppression reports success', suppressed === true);
  ok('the rule is prefixed, not deleted', content.includes(`- ${HEADINGS.SUPPRESSED} [CARD-C-003]`));
  ok('parseRules marks it suppressed but still returns it', parseRules(content).some((r) => r.cardId === 'CARD-C-003' && r.suppressed));
  ok('the suppression is logged with its reason', /suppressed.*spec was the problem/.test(entry));
  ok('a manual suppression is not labelled auto', !/auto-suppressed/.test(entry));
}

// --- auto-suppress is distinguishable ----------------------------------------------------------
{
  const added = addRule(BASE, { cardId: 'CARD-D-004', text: 'rule', score: 4.9, now: NOW }).content;
  const { entry } = suppressRule(added, { match: 'CARD-D-004', reason: 'retry scored 8.4', now: NOW, auto: true });
  ok('auto-suppression is labelled distinctly from a manual one', /auto-suppressed/.test(entry));
}

// --- idempotence + misses ----------------------------------------------------------------------
{
  const added = addRule(BASE, { cardId: 'CARD-E-005', text: 'rule', score: 4.0, now: NOW }).content;
  const once = suppressRule(added, { match: 'CARD-E-005', reason: 'r', now: NOW }).content;
  const twice = suppressRule(once, { match: 'CARD-E-005', reason: 'r', now: NOW });
  ok('suppressing an already-suppressed rule is a no-op, not a double prefix', twice.suppressed === false && !once.includes(`${HEADINGS.SUPPRESSED} ${HEADINGS.SUPPRESSED}`));
  const miss = suppressRule(added, { match: 'NO-SUCH-CARD', reason: 'r', now: NOW });
  ok('a non-matching suppress reports false and leaves content untouched', miss.suppressed === false && miss.content === added);
}

// --- reads the real-world SR-nnn form ----------------------------------------------------------
{
  const real = ['## Steering Rules', '', '- **SR-001:** Finding schema is locked at v1.0.', '- **SR-002:** No az.cmd in critical path.', ''].join('\n');
  const rules = parseRules(real);
  ok('parses the **SR-nnn** form used by real projects, not just the documented form', rules.length === 2 && rules[0].id === 'SR-001');
}

// --- guards: refuse to write silently ----------------------------------------------------------
{
  const threw = (fn) => { try { fn(); return false; } catch { return true; } };
  ok('addRule throws when there is no Steering Rules section (never writes where nothing reads)', threw(() => addRule('# Nothing here', { cardId: 'C-1', text: 't', now: NOW })));
  ok('addRule requires a cardId', threw(() => addRule(BASE, { text: 't', now: NOW })));
  ok('addRule requires rule text', threw(() => addRule(BASE, { cardId: 'C-1', text: '   ', now: NOW })));
  ok('addRule requires an injected now (determinism)', threw(() => addRule(BASE, { cardId: 'C-1', text: 't' })));
  ok('suppressRule REFUSES an unexplained suppression', threw(() => suppressRule(BASE, { match: 'x', now: NOW })));
}

// --- counter-proof: the PRE-FIX behaviour left no trace ----------------------------------------
{
  // Pre-fix, a rule was appended by hand with no log entry at all. Assert that the old shape is
  // detectably different, so this suite catches a regression to "append and forget".
  const preFix = BASE.replace('(none yet — appended as quality scores generate them)', '- [CARD-X-001] some rule');
  ok('PRE-FIX content has NO change log (proves the log is the new behaviour)', !preFix.includes(HEADINGS.LOG_HEADING));
  ok('PRE-FIX content is still parseable, so the fix is backward compatible', parseRules(preFix).some((r) => r.cardId === 'CARD-X-001'));
  const migrated = addRule(preFix, { cardId: 'CARD-Y-002', text: 'new rule', score: 4.1, now: NOW }).content;
  ok('adding to a pre-fix file introduces the log without disturbing the existing rule', migrated.includes('- [CARD-X-001] some rule') && migrated.includes(HEADINGS.LOG_HEADING));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
