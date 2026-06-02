# Persona Routing — How the Scorer Works

Data-driven reference so rule tuning is grounded, not vibes. The scorer lives in
`dashboard/packages/api/src/lib/auto-routing.ts`; rules seed from
`framework/routing-rules/seed.json` into the `routing_rules` table.

## The scoring formula

For each active rule, against a card's `description` (title + body, lowercased):

```
rawScore = 10 * [workType is present as a whole token]
         +  5 * (number of `examples` present as whole tokens)
         +  3 * [modulePattern glob matches the modulePath, if provided]

score    = rawScore * confidenceWeight + priority
```

- `confidenceWeight`: high = 3, medium = 2, low = 1.
- `priority`: integer added AFTER weighting — a tiebreaker / thumb-on-scale, not a multiplier.
- The highest-scoring rule wins. A rule with `rawScore === 0` does not compete.
- Ties resolve by the compiled sort: priority desc → confidenceWeight desc → id asc.

## Whole-token matching (not substring)

Matching uses `containsToken`, which requires the token to be flanked by
non-alphanumeric boundaries (string edges count). This is the fix for the FRW-BL-024
mis-routing class, where naive `includes()` produced false positives:

| Token | Substring false-positive (old) | Whole-token (new) |
|-------|-------------------------------|-------------------|
| `token` | matched `CancellationToken` | only matches a standalone `token` |
| `orm` | matched `normalize` | only `orm` |
| `auth` | matched `OAuth` | only `auth` (`oauth` is its own example) |
| `ui` | matched `build`, `requirements` | only `ui` |
| `seo` / `sso` | matched inside larger words | standalone only |

Punctuation **inside** a token is matched literally, so `.net`, `c#`, `sign-in`,
and `access control` (multi-word) still work — the boundary check only forbids an
adjacent `[a-z0-9]`, not adjacent punctuation or spaces.

## Negative keywords (suppression)

A rule may declare `negativeKeywords` (JSON array). If ANY is present as a whole
token, the rule is **suppressed entirely** — it scores nothing regardless of how
many positives matched. Use this when a rule's vocabulary legitimately appears in
work that belongs to a different domain. Examples shipped:

- `authentication` suppresses on `clone`, `octokit`, `libgit2sharp`, `gitleaks`,
  `cancellationtoken`, `glob`, `file enumeration`, `secret-scan` — so a git-clone or
  file-enumeration card carrying an incidental `OAuth/PAT token` no longer routes to
  `auth-specialist`.
- `devops` and `api` suppress on `gitleaks`/`secret-scan` so a secret-scan wrapper
  routes to `security-reviewer`.

## Tuning workflow (data-driven)

1. Reproduce the mis-route with the replay harness:
   `node scripts/route-replay.mjs "the card description"` (build the api package first).
   It prints the winning rule, the matched tokens, and the score.
2. Diagnose: is it a substring artifact (now fixed by whole-token matching), an
   over-broad example, or a missing example on the correct rule?
3. Fix the **minimal** thing: add a `negativeKeyword`, remove/narrow an over-broad
   example, or add a specific (preferably multi-word) example to the correct rule.
   Avoid generic single words (`page`, `token`, `fetch`) unless their boundary
   behavior is safe — verify with the harness.
4. Persist: update `framework/routing-rules/seed.json` (fresh DBs) AND add a DB
   migration that syncs existing rows (see `017-routing-negative-keywords.ts`).
   Live-only DB edits are NOT acceptable — changes must be commit-pinned.
5. Verify no regression: `node scripts/route-replay.mjs --suite` and
   `npm run test` (api) — the regression suite replays the real CLEAR cards and the
   strong-signal foundation baselines.

## Why `priority` is added, not multiplied

A high-priority rule should win *ties and near-ties*, not steamroll a rule with more
actual evidence. Because `priority` is additive post-weighting, a rule with two solid
token matches (`5*2*weight`) still beats a higher-priority rule with a single weak
match. Keep priorities in a tight band (most rules 5; bump to 7–10 only for domains
that should win genuine ties, e.g. `security`, `authentication`).
