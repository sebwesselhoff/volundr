/**
 * Persona Spawn Integration
 *
 * Connects the charter compiler pipeline to the agent spawn flow.
 * Called by Volundr when spawning a teammate to build the persona-aware
 * system prompt and record the persona assignment.
 *
 * Usage:
 *   const personaId = linkRegistryToPersona('developer');
 *   if (personaId) {
 *     const prompt = await compileAgentPrompt(personaId, ctx);
 *     // pass prompt as system prompt prefix, personaId to vldr.agents.spawn()
 *   }
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  CharterCompiler,
  IdentityLayer,
  ConstraintsLayer,
  SteeringLayer,
  DirectivesLayer,
  SkillsLayer,
  HistoryLayer,
  CardLayer,
  TraitsLayer,
} from './charter-compiler.js';
import type { CompilerContext } from './charter-compiler.js';

// ---- Public types ------------------------------------------------------------

export interface CompileContext {
  /** History entries for the persona (from DB, already decayed). */
  historyEntries: CompilerContext['historyEntries'];
  /** Persona stats (cards, projects, quality avg). */
  stats: CompilerContext['stats'];
  /** Skills matched for this persona (full body content). */
  skills: CompilerContext['skills'];
  /** Active project + global directives. */
  directives: CompilerContext['directives'];
  /** Raw text of project constraints.md (pass '' if not available). */
  constraintsMd: string;
  /** Current card spec text (pass '' when spawning outside a card context). */
  cardContext: string;
  /** Persona traits to inject. */
  traits: string[];
  /** Optional stack tags from the current card (used to surface relevant skills/history). */
  cardStackTags?: string[];
}

// ---- Registry persona mapping ------------------------------------------------

/**
 * Default persona ID for each agent type.
 * Developers may be overridden at spawn time via discovered/matched personas.
 */
const REGISTRY_PERSONA_MAP: Record<string, string> = {
  developer:         'fullstack-web',
  architect:         'architect',
  'qa-engineer':     'test-engineer',
  'devops-engineer': 'devops-infra',
  designer:          'fullstack-web',
  tester:            'test-engineer',
  guardian:          'security-reviewer',
  content:           'documentation-engineer',
  researcher:        'architect',
  // volundr, planner, review, fixer, roundtable-voice, chaos-engine-voice — no persona
};

/**
 * Map a registry agent type to its default persona ID.
 * Returns null for agent types that have no persona mapping
 * (e.g. volundr, planner, roundtable voices).
 */
export function linkRegistryToPersona(agentType: string): string | null {
  return REGISTRY_PERSONA_MAP[agentType] ?? null;
}

// ---- Charter loading ---------------------------------------------------------

/**
 * Resolve the path to a persona's charter.md seed file.
 * Seeds live at `framework/personas/seeds/{personaId}/charter.md`
 * relative to the volundr repo root (two directories up from this file).
 */
function resolveCharterPath(personaId: string): string {
  // __dirname equivalent for this file: framework/personas/
  const dir = dirname(fileURLToPath(import.meta.url));
  return join(dir, 'seeds', personaId, 'charter.md');
}

/**
 * Load charter.md text for the given persona ID.
 * Returns an empty string if the file does not exist (graceful degradation).
 */
function loadCharterMd(personaId: string): string {
  try {
    return readFileSync(resolveCharterPath(personaId), 'utf8');
  } catch {
    return '';
  }
}

// ---- Compiler factory --------------------------------------------------------

function createCompiler(): CharterCompiler {
  return new CharterCompiler([
    new IdentityLayer(),
    new ConstraintsLayer(),
    new SteeringLayer(),
    new DirectivesLayer(),
    new SkillsLayer(),
    new HistoryLayer(),
    new CardLayer(),
    new TraitsLayer(),
  ]);
}

// ---- Public API --------------------------------------------------------------

/**
 * Compile the full system prompt for a persona at spawn time.
 *
 * Steps:
 *   1. Load charter.md from seeds/{personaId}/charter.md
 *   2. Build a CharterCompiler with all 8 layers
 *   3. Compile with the provided context
 *   4. Return the assembled prompt string
 *
 * Returns an empty string if the persona has no charter seed (unknown personaId).
 * Callers should treat an empty return as "no persona prompt" and proceed
 * with the unmodified agent template.
 */
export async function compileAgentPrompt(
  personaId: string,
  context: CompileContext,
): Promise<string> {
  const charterMd = loadCharterMd(personaId);
  if (!charterMd) return '';

  const ctx: CompilerContext = {
    personaId,
    charterMd,
    historyEntries: context.historyEntries,
    stats:          context.stats,
    skills:         context.skills,
    directives:     context.directives,
    constraintsMd:  context.constraintsMd,
    cardContext:    context.cardContext,
    traits:         context.traits,
    cardStackTags:  context.cardStackTags,
    meta:           {},
  };

  const compiler = createCompiler();
  return compiler.compile(ctx);
}
