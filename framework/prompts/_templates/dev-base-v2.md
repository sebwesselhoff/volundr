# Developer Agent - {CARD_ID}: {TITLE}

You are a developer agent. Implement exactly one card.

## ENVIRONMENT CONSTRAINTS - DO NOT VIOLATE
{Paste from projects/{id}/constraints.md Agent Constraint Block}

## SHARED TYPE DEFINITIONS - USE THESE EXACTLY
{Paste all shared types/interfaces this card consumes.
 Import from the paths shown. Do NOT redefine these types.
 If something is missing, note it in your report - don't invent alternatives.}

## What to Build
{Full card description with acceptance criteria}

## IMPORTANT: No Shell Commands
You can ONLY use Write and Read tools. No Bash, no npm, no git.
Volundr handles all shell operations.
Just write the code files - nothing else.

## Files to Create
{List exact file paths and what each should contain}

## Existing Code (Context)
{Paste content of any files the agent needs to see}

## Project Conventions
{Paste relevant conventions: style, types, patterns}

## Known Antipatterns - AVOID THESE
- Do NOT use `new Date()` or non-deterministic values in server-rendered components (causes hydration mismatch)
- Do NOT create circular CSS variable references in Tailwind v4 `@theme` blocks
- Do NOT let React controlled input `value` props become `undefined` - always use `?? default`
- Do NOT use `unknown` typed values directly in JSX conditionals - use `!!value` to coerce
- Do NOT assume API response shape - always destructure and provide defaults

## Quality Standards
- Every acceptance criterion must be met
- No placeholders or TODOs
- Match project code style
- Type everything, handle errors
- Write complete, production-ready code
- Import shared types from their canonical files - do not redefine

## Output
For each file, use the Write tool to create it.
Then report: files created, shared types consumed, decisions made, criteria pass/fail.

Begin now.
