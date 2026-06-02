---
name: vldr-verify
description: Evidence-before-completion gate — run a FRESH verification command, capture its output + exit code, and emit a citable evidence block. Use before claiming a card/task done, or before any "it works / passes / is fixed / is complete" claim.
user-invocable: true
disable-model-invocation: false
---

# Volundr Verify — Evidence-Before-Completion Gate

**Iron law: no completion claim without fresh evidence.** A card MUST NOT transition to
`done`, and you MUST NOT assert "it works / passes / is fixed / is complete", unless a
verification command was run **this session** and its output + exit code are captured as
evidence tied to the specific claim.

## What counts as fresh evidence
- A command run **now** — not remembered, not assumed, not "should pass".
- Its **exit code** (0 = pass) **and** a relevant slice of stdout/stderr.
- Tied to the specific claim (the build gate, the unit test, the route check, the migration).

Stale, partial, or absent evidence → the claim is **REJECTED**. "It compiles" is the floor,
not proof the card's ISC is met.

## Procedure
1. Identify the verification command(s) for the claim:
   - Type/build: `npx tsc --noEmit`, `npx next build`, `npx vite build`, `turbo run build`
   - Hook / unit: `node <hook>.test.js`, `node --check <file>`
   - API / route: `curl -s -o NUL -w "%{http_code}" <url>` (200 = pass)
   - Migration / DB: the migrate / push command, then a row count or schema check
   - Anti-stub: `node scripts/anti-stub-scan.mjs --staged`
2. Run it and CAPTURE the exit code + output (PowerShell: check `$LASTEXITCODE`).
3. Emit an evidence block in this exact shape and attach it to the card's ISC evidence
   (or paste it where the completion claim is made):
   ```
   VERIFY [<command>]
   exit=<code>
   <relevant output, trimmed to the lines that prove the claim>
   ran: <this session / ISO timestamp>
   ```
4. If exit != 0 → the claim **FAILS**. Do not mark done; fix and re-run until green.

## Gate wiring
- **Card DoD** — `framework/quality.md` § *Verification-Before-Completion Gate*: every ISC
  criterion whose truth depends on runtime behaviour MUST carry a fresh `VERIFY` block in its
  evidence before `PATCH /api/cards/:id {status:"done"}`.
- **Blind reviewer** rejects a `passed:true` ISC whose evidence lacks a fresh command +
  exit-code when the criterion is runtime-verifiable (see `card-reviewer.md`).
- **Guardian / QA personas** enforce this at per-card and milestone review.
