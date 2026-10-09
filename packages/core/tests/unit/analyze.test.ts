import { describe, it, expect } from 'vitest';
import { analyzeReadme, exportIntelligenceJson, safeExtract, emptyIntelligence } from '../../src/analyze';
import { parseMarkdown, preprocessMarkdown, truncateToBytes, limitListNesting, MAX_INPUT_BYTES } from '../../src/parse/parseMarkdown';
import { buildSearchIndex } from '../../src/search/buildIndex';
import { IntelligenceSchema, CommandItemSchema, EnvVarItemSchema, TechItemSchema, GitHubReadmeResponseSchema, HealthReportSchema } from '../../src/schemas';
import { errorMessage, errorCopy, formatResetTime } from '../../src/errors';
import { stripEmoji, cleanItemText, truncate, wholeWordRegExp, stripHtml } from '../../src/util/text';
import { z } from 'zod';
import { GITHUB, PASTE, md, readFixture, ctxFor } from '../helpers';
import type { AppErrorCode } from '../../src/types';

const sample = readFixture('sample-readme.md');

describe('analyzeReadme on the sample README', () => {
  const r = analyzeReadme(sample, GITHUB);
  const i = r.intelligence;

  it('extracts the project card', () => {
    expect(i.project.name?.value).toBe('TaskFlow');
    expect(i.project.description?.value).toMatch(/^TaskFlow is a self-hosted task board/);
    expect(i.project.badges.length).toBe(3);
  });

  it('extracts features, prerequisites and install steps', () => {
    expect(i.features.length).toBe(5);
    expect(i.prerequisites.map((p) => p.value)).toEqual(['Node.js 20+', 'pnpm 9', 'Docker (for the local database)']);
    expect(i.installSteps.map((s) => s.commands)).toEqual([
      ['git clone https://github.com/acme/taskflow.git', 'cd taskflow'],
      ['pnpm install'],
      ['cp .env.example .env'],
      ['docker compose up -d db', 'pnpm prisma migrate dev'],
    ]);
  });

  it('extracts commands grouped by purpose', () => {
    const byCat = Object.fromEntries(i.commands.map((c) => [c.command, c.category]));
    expect(byCat).toMatchObject({ 'pnpm install': 'setup', 'pnpm dev': 'dev', 'pnpm test': 'test', 'pnpm lint': 'lint', 'vercel --prod': 'deploy', 'pnpm prisma migrate dev': 'database' });
  });

  it('extracts env vars and masks secrets', () => {
    expect(i.envVars.map((e) => e.name)).toEqual(['DATABASE_URL', 'NEXTAUTH_SECRET', 'OPENAI_API_KEY', 'PORT', 'GITHUB_ID', 'SMTP_PASSWORD']);
    expect(i.envVars.find((e) => e.name === 'OPENAI_API_KEY')).toMatchObject({ masked: true, exampleValue: '••••••••' });
  });

  it('extracts the tech stack', () => {
    expect(i.techStack.map((t) => t.name)).toEqual(
      expect.arrayContaining(['Next.js', 'React', 'Tailwind CSS', 'Node.js', 'Express', 'PostgreSQL', 'Prisma', 'NextAuth.js', 'Docker'])
    );
    expect(i.techStack.map((t) => t.name)).not.toContain('CSS');
  });

  it('extracts API endpoints with examples', () => {
    expect(i.api.map((a) => `${a.method} ${a.path}`)).toEqual(['GET /api/tasks', 'POST /api/tasks', 'DELETE /api/tasks/:id']);
    expect(i.api[0]).toMatchObject({ authRequired: true, responseExample: expect.stringContaining('Write docs') });
    expect(i.api[1]!.requestExample).toContain('New task');
  });

  it('extracts deployment, links, license and flags', () => {
    expect(i.deployment.platforms).toEqual(expect.arrayContaining(['Vercel', 'Railway']));
    expect(new Set(i.links.map((l) => l.type))).toEqual(new Set(['other', 'issues', 'demo', 'docs', 'chat', 'video', 'license']));
    expect(i.license?.value).toBe('MIT');
    expect(i.hasContributing).toBe(true);
    expect(i.hasTestsSection).toBe(true);
  });

  it('scores the sample 100 and validates against the Zod schemas', () => {
    expect(r.health.score).toBe(100);
    expect(IntelligenceSchema.safeParse(i).success).toBe(true);
    expect(HealthReportSchema.safeParse(r.health).success).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('every extracted item has a source line inside the document', () => {
    const lines = sample.split('\n').length;
    const refs = [
      ...i.features.map((x) => x.source),
      ...i.prerequisites.map((x) => x.source),
      ...i.installSteps.map((x) => x.source),
      ...i.commands.map((x) => x.source),
      ...i.envVars.map((x) => x.source),
      ...i.techStack.flatMap((x) => x.evidence.map((e) => e.source)),
      ...i.api.map((x) => x.source),
      ...i.links.map((x) => x.source),
    ];
    for (const ref of refs) {
      expect(ref.line).toBeGreaterThanOrEqual(1);
      expect(ref.line).toBeLessThanOrEqual(lines);
    }
  });

  it('builds a search index with sections, commands, env vars, tech and features', () => {
    const kinds = new Set(r.searchIndex.map((e) => e.kind));
    for (const k of ['paragraph', 'code', 'command', 'env', 'tech', 'feature']) expect(kinds.has(k as never)).toBe(true);
    expect(r.searchIndex.find((e) => e.kind === 'env' && e.title === 'DATABASE_URL')).toBeTruthy();
  });

  it('JSON export contains masked values only', () => {
    const json = exportIntelligenceJson(r);
    expect(json).not.toContain('sk-abc123');
    expect(json).not.toContain('4f9a8c2e1b7d6a5f');
    expect(JSON.parse(json).intelligence.project.name.value).toBe('TaskFlow');
  });
});

describe('robustness', () => {
  it('a README with no env, API or deployment returns empty results (no invented data)', () => {
    const r = analyzeReadme(md('# Tiny', '', 'A tiny library that pads strings on the left.', '', '```js', "leftPad('a', 3)", '```'), PASTE);
    expect(r.intelligence.envVars).toEqual([]);
    expect(r.intelligence.api).toEqual([]);
    expect(r.intelligence.deployment).toEqual({ platforms: [], steps: [] });
    expect(r.intelligence.features).toEqual([]);
    expect(r.intelligence.installSteps).toEqual([]);
  });

  it('malformed Markdown does not throw', () => {
    const inputs = [
      '```bash\nnpm install\n(unclosed fence',
      '| a | b |\n|---|\n| broken | table | extra |',
      '<div><details><summary>x',
      '#'.repeat(10) + ' too deep heading',
      '- '.repeat(500) + 'nested',
      '>'.repeat(5000) + ' quote',
      '[link](<unclosed',
      '\u0000\u0001\u0002 control chars',
      '',
    ];
    for (const input of inputs) expect(() => analyzeReadme(input, PASTE)).not.toThrow();
  });

  it('random input (fuzz) never throws', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const alphabet = ['#', ' ', '\n', '-', '*', '`', '```', '|', '>', '[', ']', '(', ')', '!', '<', '/', 'a', 'Z', '=', '_', '1', 'npm ', 'GET /', 'KEY=', '<img src=x>', '\\'];
    for (let n = 0; n < 150; n++) {
      let s = '';
      const len = Math.floor(rand() * 400);
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
      expect(() => analyzeReadme(s, PASTE)).not.toThrow();
    }
  });

  it('1 MB of random text is truncated with a warning and does not crash', () => {
    const big = 'lorem ipsum dolor sit amet '.repeat(45_000);
    const r = analyzeReadme(big, PASTE);
    expect(r.stats.bytes).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    expect(r.warnings.some((w) => /larger than 1 MB/.test(w))).toBe(true);
  });

  it('non-string input is treated as empty', () => {
    expect(() => analyzeReadme(undefined as unknown as string, PASTE)).not.toThrow();
  });

  it('a 2,000-line README parses and extracts quickly', () => {
    const big = Array.from({ length: 14 }, () => sample).join('\n');
    analyzeReadme(big, PASTE); // warm-up (regex compilation, JIT)
    const r = analyzeReadme(big, PASTE);
    expect(r.stats.lines).toBeGreaterThanOrEqual(1900);
    // PRD target is 300 ms on a normal laptop; CI machines get 3x headroom.
    expect(r.stats.parseMs + r.stats.extractMs).toBeLessThan(900);
  });
});

describe('parse helpers', () => {
  it('preprocess normalises line endings and strips the BOM', () => {
    expect(preprocessMarkdown('﻿a\r\nb\rc').markdown).toBe('a\nb\nc');
  });

  it('caps blockquote nesting without changing the line count', () => {
    const out = preprocessMarkdown('>'.repeat(100) + ' x\nnext');
    expect(out.markdown.split('\n')).toHaveLength(2);
    expect(out.warnings.length).toBe(1);
  });

  it('truncateToBytes never splits a character', () => {
    expect(truncateToBytes('héllo', 2)).toBe('h');
    expect(truncateToBytes('abc', 10)).toBe('abc');
  });

  it('limitListNesting replaces lists deeper than the limit', () => {
    const { mdast } = parseMarkdown(Array.from({ length: 6 }, (_, d) => `${'  '.repeat(d)}- level ${d}`).join('\n'));
    const pruned = limitListNesting(mdast, 3);
    expect(pruned).toBe(1);
  });
});

describe('safeExtract', () => {
  it('returns the fallback and a warning when the extractor throws', () => {
    const warnings: string[] = [];
    expect(safeExtract('x', () => { throw new Error('boom'); }, z.number(), 7, warnings)).toBe(7);
    expect(warnings).toEqual(['Extractor "x" failed and was skipped.']);
  });

  it('returns the fallback when output fails Zod validation', () => {
    const warnings: string[] = [];
    expect(safeExtract('y', () => 'not a number' as unknown as number, z.number(), 0, warnings)).toBe(0);
    expect(warnings[0]).toMatch(/invalid output/);
  });
});

describe('Zod schemas reject malformed extractor output', () => {
  const ref = { headingPath: [], line: 1 };
  it('commands', () => {
    expect(CommandItemSchema.safeParse({ command: '', category: 'setup', language: null, source: ref, risky: false }).success).toBe(false);
    expect(CommandItemSchema.safeParse({ command: 'npm i', category: 'nope', language: null, source: ref, risky: false }).success).toBe(false);
  });
  it('env vars', () => {
    expect(EnvVarItemSchema.safeParse({ name: 'BAD NAME', required: null, description: null, exampleValue: null, masked: false, source: ref }).success).toBe(false);
  });
  it('tech items need evidence', () => {
    expect(TechItemSchema.safeParse({ name: 'React', category: 'frontend', evidence: [], strength: 'strong' }).success).toBe(false);
  });
  it('source refs need a non-negative line', () => {
    expect(IntelligenceSchema.safeParse({ ...emptyIntelligence(), features: [{ value: 'x', source: { headingPath: [], line: -1 }, confidence: 'explicit' }] }).success).toBe(false);
  });
  it('confidence can never be "ai"', () => {
    expect(IntelligenceSchema.safeParse({ ...emptyIntelligence(), features: [{ value: 'x', source: ref, confidence: 'ai' }] }).success).toBe(false);
  });
  it('GitHub API response', () => {
    expect(GitHubReadmeResponseSchema.safeParse({ ok: true, markdown: '#', source: { kind: 'paste' } }).success).toBe(true);
    expect(GitHubReadmeResponseSchema.safeParse({ ok: false, error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });
});

describe('search index', () => {
  it('includes headings passed in and skips tiny paragraphs', () => {
    const ctx = ctxFor(md('# A', '', 'ok', '', 'A longer paragraph.'));
    const entries = buildSearchIndex(ctx, [{ id: 'a', text: 'A', depth: 1, line: 1 }], emptyIntelligence());
    expect(entries.map((e) => [e.kind, e.title])).toEqual([
      ['section', 'A'],
      ['paragraph', 'A longer paragraph.'],
    ]);
  });
});

describe('error copy (UI spec 7.5)', () => {
  it('uses the exact PRD strings', () => {
    expect(errorMessage('INVALID_URL')).toBe('That does not look like a GitHub repository or README link.');
    expect(errorMessage('NOT_FOUND')).toBe('No README found for this repository.');
    expect(errorMessage('PRIVATE_OR_FORBIDDEN')).toBe('This repository is private or access was denied.');
    expect(errorMessage('TOO_LARGE')).toBe('This README is larger than 1 MB, so it was not loaded.');
    expect(errorMessage('PARSE_FAILURE')).toBe('The file could not be read as Markdown.');
    expect(errorMessage('RATE_LIMITED', null)).toBe('GitHub rate limit reached. Try again at a few minutes.');
  });

  it('every code has a title and causes', () => {
    const codes: AppErrorCode[] = ['INVALID_URL', 'NOT_FOUND', 'RATE_LIMITED', 'PRIVATE_OR_FORBIDDEN', 'NETWORK', 'TOO_LARGE', 'UNKNOWN', 'PARSE_FAILURE'];
    for (const c of codes) {
      const copy = errorCopy(c);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.causes.length).toBeGreaterThan(0);
    }
  });

  it('formatResetTime handles bad input', () => {
    expect(formatResetTime('not a date')).toBe('a few minutes');
    expect(formatResetTime('2030-01-01T10:05:00Z')).toMatch(/\d/);
  });
});

describe('text utils', () => {
  it('stripEmoji / cleanItemText / truncate', () => {
    expect(stripEmoji('🚀 Go ✨')).toBe(' Go ');
    expect(cleanItemText('- ✅ **Bold** item')).toBe('Bold item');
    expect(cleanItemText(':rocket: Launch')).toBe('Launch');
    expect(truncate('one two three four', 9)).toBe('one two…');
    expect(truncate('short', 9)).toBe('short');
  });

  it('wholeWordRegExp respects word boundaries and special characters', () => {
    expect(wholeWordRegExp('c++').test('written in C++.')).toBe(true);
    expect(wholeWordRegExp('react').test('reactive')).toBe(false);
    expect(wholeWordRegExp('node.js').test('uses Node.js 20')).toBe(true);
  });

  it('stripHtml', () => {
    expect(stripHtml('<p>a &amp; <b>b</b><br>c</p><!-- x -->')).toBe('a & b c');
  });
});
