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
const PROJECT_CONTEXT_RE = /\b(?:uses?|using|used|built\s+(?:with|using|for)|powered\s+by|written\s+in|developed\s+in|based\s+on|requires?|implemented\s+(?:in|with)|stack\s+includes?|written\s+using|coded\s+in|programmed\s+in|language\s+(?:is|:)|written\s+in)\b/i;
const EXCLUDED_BEFORE_CONTEXT_RE = /\b(?:integrat(?:e|es|ed|ion|ions)|connects?|connected|supports?|supported|exports?|exported|compatible|works?|quick\s+start|examples?|such\s+as|used\s+by|community-maintained|generat(?:e|es|ed|ing))\b/i;
const EXCLUDED_AFTER_CONTEXT_RE = /^\s*(?:sdk|clients?|bindings?)\b/i;
const NEGATED_TECH_CONTEXT_RE = /\b(?:not|never|without|does\s+not|doesn['’]t|do\s+not|don['’]t|avoid(?:s|ed|ing)?)\s+(?:(?:use|using|choose|choosing|include|including|support|supporting)\s+[^.!?\n]{0,60}|[^.!?\s]*(?:\s+(?:and|or))?)\s*$/i;
const TRANSPILE_OUTPUT_NAMES = new Set(['Dart', 'Sass', 'CSS']);
const LONG_CATALOG_RE = /(?:[^,]*,){3,}[^,]*\band\s+more\b/i;
const HOSTED_SERVICE_CONTEXT_RE = /\b(?:managed|hosted)\b[^.!?\n]{0,80}$/i;

/** Product names that contain ambiguous technology terms but are not the technology itself. */
const PRODUCT_NAME_STOPLIST: Record<string, string[]> = {
  'Go': ['Expo Go', 'GoPro', 'GoDaddy', 'GoLang', 'GoKit', 'GoTo', 'GoCD', 'GoGS', 'GoJS', 'GoVue'],
  'Rust': ['Rust-Oleum', 'Rustic', 'Rustler'],
  'Swift': ['Taylor Swift', 'SwiftUI', 'SwiftPlayground'],
  'C': ['C#', 'C++', 'CMake', 'CSharp', 'Objective-C'],
  'HTML': ['HTML5', 'HTML/CSS'],
  'CSS': ['CSS3', 'CSS-in-JS', 'Tailwind CSS'],
  'Julia': ['JuliaSet'],
  'R': ['RStudio', 'RMarkdown', 'Rcpp'],
  'Zig': ['ZigZag'],
  'Remix': ['Remix OS', 'Remix IDE'],
  'Astro': ['Astro.js', 'Astro.build'],
  'Bootstrap': ['Bootstrap 5', 'Bootstrap 4', 'React Bootstrap'],
  'Expo': ['Expo Go', 'Expo SDK', 'Expo CLI', 'Expo Router'],
  'Express': ['Express.js', 'ExpressJS', 'Express VPN'],
  'Gin': ['Gin Tonic', 'Gin Rummy'],
  'Fastify': [],
  'Nest': ['NestJS', 'Nest.js'],
  'Svelte': ['SvelteKit', 'Svelte.js'],
  'Solid': ['SolidJS', 'Solid.js', 'Solidity'],
  'Preact': ['Preact X', 'Preact CLI'],
  'Qwik': ['Qwik City'],
  'Elysia': [],
  'Hono': [],
  'Koa': ['Koa.js', 'KoaJS'],
  'Bun': ['Bun.js', 'Bun.sh', 'Bunny'],
} as const;

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

/**
 * Technologies that are ONLY counted with very strong evidence (badge, code import, language tag).
 * These are commonly mentioned in prose as "supports X" or "works with X" rather than "built with X".
 */
const UBIQUITOUS_TECH_NAMES = new Set([
  'HTML',
  'CSS',
  'JavaScript',
  'Node.js',
  'Docker',
  'Docker Compose',
  'PostgreSQL',
  'MySQL',
  'Redis',
  'MongoDB',
  'SQLite',
  'TypeScript',
  'Python',
  'Go',
  'Rust',
]);

/**
 * Check if a text snippet contains strong implementation context (not just "supports" or "works with").
 */
function hasImplementationContext(text: string): boolean {
  const implPatterns = [
    /\b(?:built|written|implemented|coded|developed|created)\s+(?:with|in|using)\b/i,
    /\b(?:uses?|using)\s+(?:for\s+)?(?:the\s+)?(?:frontend|backend|api|database|ui)\b/i,
    /\b(?:our|this|the)\s+(?:stack|application|app|project)\s+(?:uses?|is\s+built)\b/i,
    /\b(?:tech\s+stack|technology\s+stack|built\s+with|powered\s+by)\b/i,
    // "is 100% TypeScript", "written in TypeScript", "100% TypeScript", "writing in X"
    /\b(?:is|written\s+in|writing\s+in)\s+\d+%\s+\w+/i,
    /\b(?:library|project|codebase|application)\s+is\s+\w+/i,
    /\b(?:100%|fully|entirely)\s+\w+/i,
    // "writing React and JavaScript", "build with React and TypeScript"
    /\b(?:writing|building)\s+(?:with|in)\s+\w+/i,
    /\b(?:built|written|implemented)\s+(?:in|using)\s+\w+/i,
    // "writing JavaScript", "building React", "writing TypeScript" (no "in")
    /\b(?:writing|building)\s+\w+/i,
  ];
  return implPatterns.some((re) => re.test(text));
}

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
  allowAmbiguous: boolean,
  inPrerequisites = false
): void {
  if (!text) return;
  let work = text;
  let workLower = text.toLowerCase();
  const strong = inTechSection || inPrerequisites || type === 'heading';
  for (const term of TERMS) {
    if (term.gated && !allowAmbiguous) continue;
    // Outside a dedicated stack section, a bare ecosystem mention is not enough
    // to claim that the project uses that technology. Require project-context
    // language while preserving strong evidence from headings, badges, commands,
    // code, and dedicated stack sections.
    // For ubiquitous technologies, use implementation context check instead of PROJECT_CONTEXT_RE
    if (!strong && type === 'text') {
      if (UBIQUITOUS_TECH_NAMES.has(term.entry.name)) {
        if (!hasImplementationContext(text)) continue;
      } else if (!PROJECT_CONTEXT_RE.test(text)) {
        continue;
      }
    }
    if (!(term.caseSensitive ? work : workLower).includes(term.needle)) continue;
    const termMatch = term.re.exec(work);
    if (!termMatch) continue;
    const before = work.slice(Math.max(0, termMatch.index - 80), termMatch.index);
    const after = work.slice(termMatch.index + termMatch[0].length, termMatch.index + termMatch[0].length + 50);
    // Skip if the match is part of a known product name (e.g., "Expo Go" for Go language)
    const stoplist = PRODUCT_NAME_STOPLIST[term.entry.name as keyof typeof PRODUCT_NAME_STOPLIST];
    if (stoplist) {
      const context = (before + termMatch[0] + after).toLowerCase();
      if (stoplist.some((product) => context.includes(product.toLowerCase()))) continue;
    }
    if (!strong && type === 'text' && LONG_CATALOG_RE.test(text)) continue;
    if (!strong && type === 'text' && HOSTED_SERVICE_CONTEXT_RE.test(before)) continue;
    if (type === 'text' && term.entry.name === 'CSS' && /tailwind\s+css/i.test(text)) continue;
    if (type === 'text' && term.entry.name === 'SQL' && /\b(?:postgres|postgresql)\b/i.test(text)) continue;
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
  // But we still want to capture badges and code blocks from deployment sections.
  const isDeploymentSection = block.section === 'deployment';

  const inTech = block.section === 'techstack';
  const allowAmbiguous = inTech || block.section === 'prerequisites';

  if (block.isHeading) {
    if (!isDeploymentSection) {
      matchText(collector, block.headingText ?? '', refFor(block), 'heading', inTech, allowAmbiguous || inTech, block.section === 'prerequisites');
    }
    return;
  }

  // Badges and images (markdown images and <img> in HTML blocks) - process even in deployment sections
  visit(block.node, 'image', (img: Image) => {
    if (isBadgeUrl(img.url)) {
      // In deployment sections, filter out generic "Deploy on X" / "Deploy to X" option buttons
      // Keep only badges that look like the primary deployment method for this project
      if (isDeploymentSection) {
        const alt = (img.alt ?? '').toLowerCase();
        // Skip generic deployment option buttons
        if (/deploy\s+(?:on|to)\s+\w+/i.test(alt) && !/\b(?:this|our|my|the)\s+(?:project|app|repo)\b/i.test(alt)) {
          // But keep if it's a "Deploy with X" for this project
          if (!/deploy\s+with\s+\w+/i.test(alt)) return;
        }
      }
      matchBadge(collector, img.alt ?? '', img.url, refFor(block, img));
    }
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
        if (src && isBadgeUrl(src)) {
          if (isDeploymentSection) {
            const altLower = alt.toLowerCase();
            if (/deploy\s+(?:on|to)\s+\w+/i.test(altLower) && !/\b(?:this|our|my|the)\s+(?:project|app|repo)\b/i.test(altLower)) {
              if (!/deploy\s+with\s+\w+/i.test(altLower)) return;
            }
          }
          matchBadge(collector, alt, src, refFor(block, h));
        }
      }
    }
  }

  // Code blocks: language tags and import patterns - process even in deployment sections
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

  // Prose - skip in deployment sections
  if (!isDeploymentSection) {
    for (const unit of proseUnits(block.node)) {
      const source = refFor(block);
      source.line = unit.line || block.line;
      const contextual = allowAmbiguous || PROJECT_CONTEXT_RE.test(unit.text);
      matchText(collector, unit.text, source, 'text', inTech, contextual, block.section === 'prerequisites');
    }
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
