# 0002 — Port third-party instruction; never install it

**Status:** Accepted · **Date:** 2026-08-27 · **Cards:** FRW-BL-098, FRW-BL-097
*Retrofitted from the adoption research and the provenance work.*

## Gate

- **Hard to reverse:** yes. Installing a marketplace or skill catalogue creates an ongoing
  dependency on a source that updates itself. Backing out later means auditing everything that
  arrived in the meantime and re-implementing whatever is load-bearing — with no record of what the
  content looked like when it was trusted.
- **Surprising:** yes. Installing is the *designed* path — these catalogues exist to be installed,
  and refusing that in favour of reimplementing by hand looks like wasted effort until you see why.
- **Trade-off:** yes, and it is not free. We give up upstream maintenance and fixes permanently, in
  exchange for a one-time reviewable diff.

## Context

Volundr's memory doctrine (FRW-BL-048/069) treats all persistent memory as attacker-influenced
**data**: lessons, patterns, journal entries and steering rules are nonce-fenced with an
ignore-embedded-instructions preamble and gated by an HMAC-signed manifest.

A skill, prompt or pack artifact is **not data**. It reaches the model *as instruction* and can
direct tool use. `memory-loader.js` wraps a poisoned lesson; **nothing wraps a poisoned skill**, and
nothing could — fencing instruction so it cannot be acted on leaves it doing nothing.

This is not theoretical. Assessing 11 external repositories for adoption found:

- `NousResearch/hermes-agent` ships `optional-skills/security/godmode` — a ready-to-fire jailbreak
  with credited techniques from public jailbreak-prompt repositories, targeting Claude, GPT, Gemini
  and Grok. **Installing that repo's skill set installs that**, and it activates on a description
  match rather than a deliberate call.
- `affaan-m/ECC` ships 287 skills of which 286 are auto-invocable, with no runtime router.
- `addyosmani/agent-skills` warns in its **own** comparison document that stacked meta-routers fight
  over command names — the exact collision Volundr already had to patch for `using-superpowers`.

## Decision

**Port, never install.** Adopt the mechanism, reimplement it in Volundr's own wording against
Volundr's own interfaces, review it once at a pinned commit — after which it is Volundr's own code
under Volundr's own review discipline.

## What we gave up

Upstream maintenance. A ported mechanism does not receive the original author's bug fixes or
improvements; if the upstream gets better, we do not. We also pay the reimplementation cost every
time, which is why most adoption items are small.

## Consequences

- Almost every adoption item is a reimplementation and therefore creates **no attribution obligation
  at all**. A sparse `THIRD-PARTY-NOTICES.md` beside a large adoption backlog is the correct result,
  not evidence of sloppiness (`framework/provenance.md`).
- Trust becomes a **one-time, auditable diff** instead of a standing dependency.
- **State the benefit honestly.** Porting *reduces* exposure; it does not eliminate it. A reviewer
  can miss something, and a reviewed artifact is still instruction the model will act on. The honest
  claim is "trust was made one-time and auditable", not "this is now safe" — and the stronger, false
  version is exactly what would justify skipping the adversarial read.
- Every ported artifact carries a `provenance:` block naming who reviewed it, enforced by
  `garden-lint`. "Nobody is on record" is not a reachable state.
