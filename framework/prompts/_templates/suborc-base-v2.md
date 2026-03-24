Output a JSON array of task cards for the {DOMAIN} domain.

[PASTE ALL CONTEXT INLINE - stack, conventions, types, file paths]
[PASTE CONSTRAINTS FROM projects/{id}/constraints.md]

Output ONLY the raw JSON array. No markdown fences, no explanation.
Start with [ end with ].

Each card object must have these exact keys:
- id: "CARD-{PREFIX}-001" format
- title: short title
- size: "XS"|"S"|"M"|"L"
- priority: "high"|"medium"|"low"
- deps: array of card IDs or empty array
- description: 2-3 sentences
- criteria: array of acceptance criteria strings
- files_to_create: array of "path - description" strings
- technical_notes: one sentence

Generate exactly N cards:
1. CARD-XX-001: [exact spec]
2. CARD-XX-002: [exact spec]
