import type { Code, Html, Image, RootContent, Table, List } from 'mdast';
import { visit } from 'unist-util-visit';
import type { CommandItem, SourceRef, TechCategory, TechEvidence, TechItem } from '../types';
import type { Block, DocContext } from './context';
import { blockText, hasSection, refFor, lineOf } from './context';
import { TECH_DICTIONARY, type TechEntry } from './techDictionary';
import { collapseWhitespace, stripHtml, truncate, wholeWordRegExp } from '../util/text';
import { isBadgeUrl } from './project';
import { SHELL_LANGS } from './commands';

/**
 * Tech stack extractor (Extractor spec 4.7).
 * - Whole-word matching only ("react" never matches "reactive").
 * - Every returned item has at least one piece of evidence with a source.
 * - Strong evidence: badge, command, code (language tag or import), heading, or anything inside
 *   a Tech stack section. Weak evidence: a passing mention in prose elsewhere.
 * - If the README has a Tech stack section, weak-only items are dropped.
 */

interface CompiledEntry {
  entry: TechEntry;
  badgeRes: RegExp[];
  langTags: Set<string>;
}

const COMPILED: CompiledEntry[] = TECH_DICTIONARY.map((entry) => ({
  entry,
  // Strict aliases are useful for disambiguating prose (for example, Go vs. go),
  // but badge URLs contain noisy path/query tokens such as the /c/ in codecov.
  badgeRes: [...entry.aliases, ...(entry.badge ?? [])].map((a) => wholeWordRegExp(a, 'i')),
  langTags: new Set((entry.langTags ?? []).map((l) => l.toLowerCase())),
}));

const CATEGORY_ORDER: TechCategory[] = [
  'language',
  'frontend',
  'backend',
  'database',
  'auth',
  'ai-ml',
  'cloud',
  'devops',
  'testing',
  'tooling',
];

const MAX_EVIDENCE = 5;
const PROJECT_CONTEXT_RE = /\b(?:uses?|used|built\s+(?:with|using|for)|powered\s+by|written\s+in|developed\s+in|based\s+on|requires?|implemented\s+(?:in|with)|stack\s+includes?)\b/i;
const EXCLUDED_BEFORE_CONTEXT_RE = /\b(?:integrat(?:e|es|ed|ion|ions)|connects?|connected|supports?|supported|exports?|exported|compatible|works?|quick\s+start|examples?|such\s+as|used\s+by|community-maintained|generat(?:e|es|ed|ing))\b/i;
const EXCLUDED_AFTER_CONTEXT_RE = /^\s*(?:sdk|clients?|bindings?)\b/i;
const NEGATED_TECH_CONTEXT_RE = /\b(?:not|never|without|does\s+not|doesn['’]t|do\s+not|don['’]t|avoid(?:s|ed|ing)?)\s+(?:(?:use|using|choose|choosing|include|including|support|supporting)\s+[^.!?\n]{0,60}|[^.!?\s]*(?:\s+(?:and|or))?)\s*$/i;
const TRANSPILE_OUTPUT_NAMES = new Set(['Dart', 'Sass', 'CSS']);
const LONG_CATALOG_RE = /(?:[^,]*,){3,}[^,]*\band\s+more\b/i;
const HOSTED_SERVICE_CONTEXT_RE = /\b(?:managed|hosted)\b[^.!?\n]{0,80}$/i;

/**
 * Tools commonly mentioned while documenting contribution or installation workflows.
 * They are useful evidence, but a command such as `npm install` does not by itself mean
 * npm is part of the application's implementation stack. An explicit Tech Stack section
 * can still opt these names in.
 */
const INCIDENTAL_STACK_NAMES = new Set([
  'GitHub Actions',
  'Git',
  'Make',
  'npm',
  'pnpm',
  'Yarn',
  'Bun',
  'Prettier',
  'VS Code',
  'uv',
  'R',
  'Ruff',
]);

interface Found {
  entry: TechEntry;
  evidence: TechEvidence[];
  strong: boolean;
  firstLine: number;
}

class Collector {
  readonly found = new Map<string, Found>();

  add(entry: TechEntry, type: TechEvidence['type'], snippet: string, source: SourceRef, strong: boolean): void {
    let f = this.found.get(entry.name);
    if (!f) {
      f = { entry, evidence: [], strong: false, firstLine: source.line };
      this.found.set(entry.name, f);
    }
    f.strong = f.strong || strong;
    f.firstLine = Math.min(f.firstLine, source.line);
    const clean = truncate(collapseWhitespace(snippet), 120);
    const dup = f.evidence.some((e) => e.type === type && e.snippet === clean && e.source.line === source.line);
    if (!dup && f.evidence.length < MAX_EVIDENCE) f.evidence.push({ type, snippet: clean, source });
    // Prefer to keep a strong piece of evidence visible if we are at the cap.
    else if (!dup && strong && !f.evidence.some((e) => e.type !== 'text')) {
      f.evidence[f.evidence.length - 1] = { type, snippet: clean, source };
    }
  }
}

/** Snippet around the first match, for the evidence tooltip. */
function snippetAround(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return truncate(text, 120);
  const start = Math.max(0, m.index - 40);
  const end = Math.min(text.length, m.index + m[0].length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

interface Term {
  entry: TechEntry;
  re: RegExp;
  reAll: RegExp;
  needle: string;
  caseSensitive: boolean;
  /** Only usable where ambiguous words are allowed (tech stack / prerequisites / headings). */
  gated: boolean;
}

/** All prose terms, longest first, so "Tailwind CSS" is consumed before "CSS" and "React Native" before "React". */
const TERMS: Term[] = TECH_DICTIONARY.flatMap((entry) => [
  ...entry.aliases.map((a) => {
    const re = wholeWordRegExp(a, 'i');
    return { entry, re, reAll: new RegExp(re.source, 'gi'), needle: a.toLowerCase(), caseSensitive: false, gated: !!entry.ambiguous };
  }),
  ...(entry.strict ?? []).map((s) => {
    const re = wholeWordRegExp(s, '');
    return { entry, re, reAll: new RegExp(re.source, 'g'), needle: s, caseSensitive: true, gated: !!entry.ambiguous };
  }),
]).sort((a, b) => b.needle.length - a.needle.length);

/**
 * Match prose text against the dictionary. A matched span is blanked out so that
 * shorter terms cannot match inside it (no "CSS" from "Tailwind CSS").
 */
function matchText(
  collector: Collector,
  text: string,
  source: SourceRef,
  type: 'text' | 'heading',
  inTechSection: boolean,
  allowAmbiguous: boolean
): void {
  if (!text) return;
  let work = text;
  let workLower = text.toLowerCase();
  const strong = inTechSection || type === 'heading';
  for (const term of TERMS) {
    if (term.gated && !allowAmbiguous) continue;
    // Outside a dedicated stack section, a bare ecosystem mention is not enough
    // to claim that the project uses that technology. Require project-context
    // language while preserving strong evidence from headings, badges, commands,
    // code, and dedicated stack sections.
    if (!strong && type === 'text' && !PROJECT_CONTEXT_RE.test(text)) continue;
    if (!(term.caseSensitive ? work : workLower).includes(term.needle)) continue;
    const termMatch = term.re.exec(work);
    if (!termMatch) continue;
    const before = work.slice(Math.max(0, termMatch.index - 80), termMatch.index);
    const after = work.slice(termMatch.index + termMatch[0].length, termMatch.index + termMatch[0].length + 50);
    if (!strong && type === 'text' && LONG_CATALOG_RE.test(text)) continue;
    if (!strong && type === 'text' && HOSTED_SERVICE_CONTEXT_RE.test(before)) continue;
    if (type === 'text' && term.entry.name === 'CSS' && /tailwind\s+css/i.test(text)) continue;
    if (type === 'text' && TRANSPILE_OUTPUT_NAMES.has(term.entry.name) && /\btranspil\w*\b/i.test(text)) continue;
    if (type === 'text' && term.entry.name === 'OpenAI' && /\bmodels?\s*:/i.test(text)) continue;
    const excludedByContext =
      !strong &&
      type === 'text' &&
      (EXCLUDED_BEFORE_CONTEXT_RE.test(before) || EXCLUDED_AFTER_CONTEXT_RE.test(after));
    if (excludedByContext || NEGATED_TECH_CONTEXT_RE.test(before)) continue;
    collector.add(term.entry, type, snippetAround(text, term.re), source, strong);
    work = work.replace(term.reAll, (m) => ' '.repeat(m.length));
    workLower = work.toLowerCase();
  }
}

/** Normalize a package/module identifier for matching against dictionary aliases. */
function packageName(value: string): string {
  const segment = value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`;,)]+$/, '')
    .replace(/@[\w.-]+$/, '')
    .split('/')
    .filter(Boolean)
    .pop();
  return segment ? segment.replace(/\.(?:js|ts|py)$/i, '').toLowerCase() : '';
}

function packageNeedle(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function packageMatches(entry: TechEntry, specifier: string): boolean {
  const names = specifier
    .trim()
    .replace(/@[\w.-]+$/, '')
    .split('/')
    .filter(Boolean)
    .map(packageName)
    .filter(Boolean);
  if (names.length === 0) return false;
  const candidates = [entry.name, ...entry.aliases, ...(entry.strict ?? [])]
    .map(packageNeedle)
    .filter(Boolean);
  return names.some((name) => candidates.some((candidate) => name === candidate || name.startsWith(`${candidate}-`)));
}

function matchPackageEvidence(collector: Collector, specifier: string, type: 'code' | 'command', snippet: string, source: SourceRef): void {
  for (const c of COMPILED) {
    if (packageMatches(c.entry, specifier)) collector.add(c.entry, type, snippet, source, true);
  }
}

function packageSpecifiersFromInstall(command: string): string[] {
  const match = /^(?:python\s+-m\s+)?(?:pip3?|npm|pnpm|yarn|bunx?|poetry|cargo|go|gem|composer)\s+(?:install|i|add|get|require)\s+(.+)$/i.exec(command.trim());
  if (!match) return [];
  return (match[1] ?? '')
    .split(/\s+/)
    .filter((token) => token && !token.startsWith('-') && !/^https?:\/\//i.test(token) && !token.includes('=') && !/^\.?\//.test(token));
}

function matchPackageImports(collector: Collector, code: string, source: SourceRef): void {
  const importRe = /(?:from\s+|import\s+|require\(\s*)['"]([^'"]+)['"]\s*\)?|(?:from\s+|import\s+)([A-Za-z_][\w.-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(code)) !== null) {
    const specifier = match[1] ?? match[2] ?? '';
    matchPackageEvidence(collector, specifier, 'code', `import ${specifier}`, source);
  }
}

function matchBadge(collector: Collector, alt: string, url: string, source: SourceRef): void {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  // shields.io: /badge/React-18-blue?logo=react ; separators become spaces
  const haystack = `${alt} ${decoded}`.replace(/[-_/=&?+:]/g, ' ');
  for (const c of COMPILED) {
    if (c.entry.name === 'CSS' && /tailwind\s*css/i.test(alt)) continue;
    if (c.entry.name === 'VS Code' && /devcontainer|dev\s+containers?/i.test(alt)) continue;
    const re = c.badgeRes.find((r) => r.test(haystack));
    if (!re) continue;
    collector.add(c.entry, 'badge', alt || url, source, true);
  }
  // CI badge URLs that name the provider only in the path.
  if (/github\.com\/[^/]+\/[^/]+\/(actions\/)?workflows\//i.test(url)) {
    const gha = COMPILED.find((c) => c.entry.name === 'GitHub Actions');
    if (gha) collector.add(gha.entry, 'badge', alt || 'workflow badge', source, true);
  }
}

function proseOf(node: RootContent): string {
  if (node.type === 'code' || node.type === 'html' || node.type === 'yaml' || node.type === 'definition') return '';
  return blockText(node);
}

/** Per-row / per-item text so evidence points at the right line. */
function proseUnits(node: RootContent): { text: string; line: number }[] {
  if (node.type === 'list') {
    const units: { text: string; line: number }[] = [];
    for (const item of (node as List).children) {
      units.push({ text: blockText(item), line: lineOf(item) });
    }
    return units;
  }
  if (node.type === 'table') {
    return (node as Table).children.map((row) => ({ text: blockText(row), line: lineOf(row) }));
  }
  if (node.type === 'html') {
    const text = stripHtml((node as Html).value);
    return text ? [{ text, line: lineOf(node) }] : [];
  }
  const text = proseOf(node);
  return text ? [{ text, line: lineOf(node) }] : [];
}

function scanBlock(collector: Collector, block: Block): void {
  // Deployment targets and deployment tooling describe where/how the project is
  // shipped, not the implementation stack. Keep those claims in deployment data.
  if (block.section === 'deployment') return;

  const inTech = block.section === 'techstack';
  const allowAmbiguous = inTech || block.section === 'prerequisites';

  if (block.isHeading) {
    matchText(collector, block.headingText ?? '', refFor(block), 'heading', inTech, allowAmbiguous || inTech);
    return;
  }

  // Badges and images (markdown images and <img> in HTML blocks)
  visit(block.node, 'image', (img: Image) => {
    if (isBadgeUrl(img.url)) matchBadge(collector, img.alt ?? '', img.url, refFor(block, img));
  });
  if (block.node.type === 'html' || block.node.type === 'paragraph') {
    const htmls: Html[] = [];
    if (block.node.type === 'html') htmls.push(block.node as Html);
    else visit(block.node, 'html', (h: Html) => void htmls.push(h));
    for (const h of htmls) {
      const re = /<img\b[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(h.value)) !== null) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? '';
        const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? '';
        if (src && isBadgeUrl(src)) matchBadge(collector, alt, src, refFor(block, h));
      }
    }
  }

  // Code blocks: language tags and import patterns
  visit(block.node, 'code', (code: Code) => {
    const lang = (code.lang ?? '').toLowerCase().trim();
    const source = refFor(block, code);
    if (lang) {
      for (const c of COMPILED) {
        if (c.langTags.has(lang)) collector.add(c.entry, 'code', `\`\`\`${lang}`, source, true);
      }
    }
    if (!SHELL_LANGS.has(lang)) {
      for (const c of COMPILED) {
        const re = c.entry.code?.find((r) => r.test(code.value));
        if (re) collector.add(c.entry, 'code', snippetAround(code.value, re), source, true);
      }
      matchPackageImports(collector, code.value, source);
    }
  });

  // Prose
  for (const unit of proseUnits(block.node)) {
    const source = refFor(block);
    source.line = unit.line || block.line;
    const contextual = allowAmbiguous || PROJECT_CONTEXT_RE.test(unit.text);
    matchText(collector, unit.text, source, 'text', inTech, contextual);
  }
}

export function extractTechStack(ctx: DocContext, commands: CommandItem[]): TechItem[] {
  const collector = new Collector();

  for (const block of ctx.blocks) scanBlock(collector, block);

  for (const cmd of commands) {
    for (const c of COMPILED) {
      if (c.entry.commands?.some((re) => re.test(cmd.command))) {
        collector.add(c.entry, 'command', cmd.command, cmd.source, true);
      }
    }
    for (const specifier of packageSpecifiersFromInstall(cmd.command)) {
      matchPackageEvidence(collector, specifier, 'command', cmd.command, cmd.source);
    }
  }

  const techSectionExists = hasSection(ctx, 'techstack');
  const items: (TechItem & { firstLine: number })[] = [];
  for (const f of collector.found.values()) {
    if (f.evidence.length === 0) continue;
    if (techSectionExists && !f.strong) continue;
    if (INCIDENTAL_STACK_NAMES.has(f.entry.name) && f.evidence.every((e) => e.type === 'command' || e.type === 'code')) continue;
    if (!techSectionExists && INCIDENTAL_STACK_NAMES.has(f.entry.name)) continue;
    items.push({
      name: f.entry.name,
      category: f.entry.category,
      evidence: f.evidence,
      strength: f.strong ? 'strong' : 'weak',
      firstLine: f.firstLine,
    });
  }

  items.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.firstLine - b.firstLine
  );
  return items.map(({ firstLine: _firstLine, ...item }) => item);
}
