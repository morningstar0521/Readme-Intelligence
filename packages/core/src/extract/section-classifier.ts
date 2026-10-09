import type { SectionType } from '../types';
import { stripEmoji } from '../util/text';

/**
 * Section classifier (Extractor spec 4.1).
 *
 * Heading text is normalised first (emoji, numbering and punctuation removed),
 * then matched against case-insensitive whole-word aliases. Rules are checked in
 * order and the first match wins. Order is from most specific to most generic,
 * so "Running tests" is testing (not usage) and "API keys" is configuration (not api).
 */

type Rule = [SectionType, string[]];

export const SECTION_RULES: Rule[] = [
  // Specific multi-word phrases that would otherwise be caught by a generic alias.
  ['configuration', ['api key', 'api keys', 'environment variables', 'environment variable', 'env vars', 'env variables', 'secrets']],
  ['license', ['license', 'licence', 'licensing']],
  ['contributing', ['contributing', 'contribution', 'contributions', 'how to contribute', 'contribute']],
  ['testing', ['test', 'testing', 'tests', 'running tests', 'run tests']],
  ['deployment', ['deployment', 'deploy', 'deploying', 'hosting', 'production']],
  ['api', ['api', 'endpoints', 'endpoint', 'routes', 'reference', 'api reference', 'rest api']],
  ['techstack', ['tech stack', 'techstack', 'built with', 'technologies', 'technologies used', 'stack', 'powered by', 'tech']],
  ['prerequisites', ['prerequisites', 'prerequisite', 'requirements', 'before you begin', 'system requirements']],
  ['features', ['features', 'feature', 'highlights', 'key features', 'capabilities', 'what it does']],
  ['installation', ['installation', 'install', 'installing', 'getting started', 'get started', 'setup', 'set up', 'setting up', 'quick start', 'quickstart']],
  ['configuration', ['configuration', 'config', 'configure', 'environment', 'env', '.env', 'settings']],
  ['usage', ['usage', 'how to use', 'running', 'run', 'examples', 'example']],
  ['structure', ['project structure', 'folder structure', 'directory structure', 'file structure', 'architecture']],
  ['roadmap', ['roadmap', 'todo', 'to do', 'future work']],
  ['overview', ['overview', 'about', 'introduction', 'description', 'what is']],
];

/** Lowercase, strip emoji, numbering ("1.", "2.3", "Step 1:"), and punctuation except "." and "+" and "#". */
export function normalizeHeadingText(text: string): string {
  let out = stripEmoji(text).toLowerCase();
  out = out.replace(/[^\p{L}\p{N}\s.+#]/gu, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/^(?:step\s+)?\d+(?:\.\d+)*\.?\s+/, '');
  out = out.replace(/(?<!\S)\.(?!env)/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const padded = ` ${haystack} `;
  return padded.includes(` ${phrase} `);
}

/** Map heading text to a canonical section type, or null. */
export function classifySection(headingText: string): SectionType | null {
  if (typeof headingText !== 'string' || headingText.trim() === '') return null;
  const normalized = normalizeHeadingText(headingText);
  if (!normalized) return null;
  for (const [type, aliases] of SECTION_RULES) {
    for (const alias of aliases) {
      if (containsPhrase(normalized, alias)) return type;
    }
  }
  return null;
}
