export interface SkillFrontmatter {
  name: string;
  description: string;
  domain: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  version: number;
  validatedAt: string;
  reviewByDate: string;
  triggers: string[];
  roles: string[];
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  sections: {
    context?: string;
    patterns?: string;
    examples?: string;
    antiPatterns?: string;
  };
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles the simple subset used by skill files:
 *   - key: "quoted value" or key: unquoted value  -> string
 *   - key: N (bare number)                         -> number
 *   - key:\n  - item\n  - item                    -> string array
 * No npm dependencies required.
 */
function parseYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comment lines
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Key with a value on the same line: `key: value` or `key: "value"`
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const rest = kvMatch[2].trim();

    if (rest === '') {
      // Could be the start of a block sequence — collect `  - item` lines
      const items: string[] = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        items.push(lines[i].replace(/^\s+-\s+/, '').trim().replace(/^"|"$/g, ''));
        i++;
      }
      result[key] = items;
      continue;
    }

    // Inline comment stripped after `  #` — only outside quotes
    const valueRaw = rest.replace(/\s+#.*$/, '');

    // Quoted string
    if (valueRaw.startsWith('"') && valueRaw.endsWith('"')) {
      result[key] = valueRaw.slice(1, -1);
      i++;
      continue;
    }

    // Bare number
    if (/^\d+$/.test(valueRaw)) {
      result[key] = parseInt(valueRaw, 10);
      i++;
      continue;
    }

    // Unquoted string (covers dates, enums, etc.)
    result[key] = valueRaw;
    i++;
  }

  return result;
}

const HEADING_TO_SECTION: Record<string, keyof ParsedSkill['sections']> = {
  'context': 'context',
  'patterns': 'patterns',
  'examples': 'examples',
  'anti-patterns': 'antiPatterns',
};

function extractSections(body: string): ParsedSkill['sections'] {
  const sections: ParsedSkill['sections'] = {};
  const headingRegex = /^## (.+)$/gm;
  const splits: Array<{ heading: string; start: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(body)) !== null) {
    splits.push({ heading: match[1].trim(), start: match.index });
  }

  for (let idx = 0; idx < splits.length; idx++) {
    const { heading, start } = splits[idx];
    const end = idx + 1 < splits.length ? splits[idx + 1].start : body.length;
    const content = body.slice(start, end).replace(/^## .+\n?/, '').trim();
    const sectionKey = HEADING_TO_SECTION[heading.toLowerCase()];
    if (sectionKey) {
      sections[sectionKey] = content;
    }
  }

  return sections;
}

function applyDefaults(raw: Record<string, unknown>): SkillFrontmatter {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsLater = new Date(Date.now() + 182 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return {
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    domain: String(raw.domain ?? ''),
    confidence: (['low', 'medium', 'high'].includes(raw.confidence as string)
      ? raw.confidence
      : 'medium') as 'low' | 'medium' | 'high',
    source: String(raw.source ?? 'seed'),
    version: typeof raw.version === 'number' ? raw.version : 1,
    validatedAt: String(raw.validatedAt ?? today),
    reviewByDate: String(raw.reviewByDate ?? sixMonthsLater),
    triggers: Array.isArray(raw.triggers) ? (raw.triggers as string[]) : [],
    roles: Array.isArray(raw.roles) ? (raw.roles as string[]) : [],
  };
}

export function parseSkillMd(content: string): ParsedSkill {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error('Invalid SKILL.md: no YAML frontmatter found');

  const rawYaml = parseYaml(fmMatch[1]);
  const frontmatter = applyDefaults(rawYaml);

  if (!frontmatter.name) throw new Error('Invalid SKILL.md: required field "name" is missing');
  if (!frontmatter.description) throw new Error('Invalid SKILL.md: required field "description" is missing');
  if (!frontmatter.domain) throw new Error('Invalid SKILL.md: required field "domain" is missing');

  const body = fmMatch[2].trim();
  const sections = extractSections(body);

  return { frontmatter, body, sections };
}
