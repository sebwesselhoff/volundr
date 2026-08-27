# Third-Party Notices

Volundr is MIT-licensed (`Copyright (c) 2026 Sebastian Wesselhoff`, see `LICENSE`) and is
**redistributed** as a public Claude Code plugin. MIT permits incorporating third-party content but
**requires retaining the upstream copyright notice and licence text**. This file discharges that
obligation. It is checked mechanically — see *Enforcement* below.

> **An attribution file whose entries are wrong is worse than no file at all**, because it looks
> discharged while being inaccurate. Every entry records the copyright holder **exactly as the
> upstream `LICENSE` states it**, never as inferred from the repository URL or the GitHub account
> name. A real example this project already tripped over: `msitarzewski/agency-agents` declares
> `Copyright (c) 2025 AgentLand Contributors` — a project name, not the account name.

---

## The convention

**`framework/provenance.md` is the single authoritative statement** of when an entry is required,
what fields it carries, and how the check works. It is deliberately not restated here: two copies of
one policy drift, and the copy someone happens to read is then the wrong one.

The short version, for a reader who arrived at this file first:

- **Copyright protects expression, not ideas.** Reimplementing a mechanism in Volundr's own wording
  creates no obligation; shipping upstream bytes or closely-recognisable phrasing does.
- **When it is arguable, attribute.** An unnecessary entry costs four lines; a missing one is a
  licence violation in redistributed software.
- **Every entry carries six fields** — `source`, pinned `commit`, `license` (SPDX), `copyright`
  verbatim from the upstream LICENSE, `date`, and `taken`. The linter refuses an incomplete entry,
  so nothing can sit here looking finished while being unusable.
- Because *port, never install* is the standing adoption rule, most adoption work produces **no
  entry at all**. A sparse registry beside a large adoption backlog is the correct result, not an
  oversight.

## Enforcement

`node scripts/garden-lint.mjs` cross-checks this file against the repo in both directions
(`FRW-BL-097`, `FRW-BL-098`): an artifact declaring provenance with no entry here is an error, and
an entry here matching no artifact is an error — a notice for content we do not ship is its own kind
of false statement. Field-level rules and the marker format live in `framework/provenance.md`.

---

## Registry

### MIT

<!-- vldr:entries-begin MIT -->
```yaml
- source: msitarzewski/agency-agents
  commit: 3c9588880b7cafaec325a104899fd8bbe27e7d72
  license: MIT
  copyright: Copyright (c) 2025 AgentLand Contributors
  date: 2026-08-27
  taken: Trait vocabulary only - the names determinism-first, trade-off-explicit and causal-rigor, plus the threat-modeling concept folded into expertise.security. All definitions in framework/agents/traits.yaml are written fresh against Volundr's own failure history; no upstream wording was copied.
```
<!-- vldr:entries-end MIT -->

**On this entry.** Whether a short trait name paired with an originally-written definition is a
derivative work at all is genuinely arguable, and the honest answer is probably not. It is attributed
regardless, per the rule in `framework/provenance.md`: when it is arguable, attribute. Four lines
here cost nothing; being wrong in the other direction is a licence violation in redistributed
software.

Note the copyright holder. The upstream `LICENSE` at the pinned commit reads **"AgentLand
Contributors"** — a project name that appears nowhere in the repository URL or the maintainer's
account name. Recording `msitarzewski` here would have produced a file that looks discharged while
being wrong, which is the failure mode this register exists to avoid.

---

## Licence texts

Reproduced in full, as MIT requires. A licence text is included here only while at least one entry
above depends on it.

<!-- vldr:licences-begin -->

### MIT — as published by `msitarzewski/agency-agents` at `3c95888`

```text
MIT License

Copyright (c) 2025 AgentLand Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

<!-- vldr:licences-end -->
