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

No MIT-licensed third-party content is currently incorporated.

<!-- vldr:entries-begin MIT -->
<!-- vldr:entries-end MIT -->

---

## Licence texts

Reproduced in full, as MIT requires. A licence text is included here only while at least one entry
above depends on it.

<!-- vldr:licences-begin -->
<!-- vldr:licences-end -->
