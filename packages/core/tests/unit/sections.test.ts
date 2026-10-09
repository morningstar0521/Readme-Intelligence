import { describe, it, expect } from 'vitest';
import { classifySection, normalizeHeadingText } from '../../src/extract/section-classifier';
import { buildContext, blockText, hasSection } from '../../src/extract/context';
import { parseMarkdown } from '../../src/parse/parseMarkdown';
import { ctxFor, md } from '../helpers';

describe('classifySection', () => {
  it.each([
    ['Overview', 'overview'],
    ['About the project', 'overview'],
    ['What is TaskFlow?', 'overview'],
    ['Features', 'features'],
    ['Key Features', 'features'],
    ['✨ Highlights', 'features'],
    ['Tech Stack', 'techstack'],
    ['Built With', 'techstack'],
    ['Technologies Used', 'techstack'],
    ['Prerequisites', 'prerequisites'],
    ['System Requirements', 'prerequisites'],
    ['Installation', 'installation'],
    ['🚀 Getting Started', 'installation'],
    ['1. Quick Start', 'installation'],
    ['Setup', 'installation'],
    ['Usage', 'usage'],
    ['How to use', 'usage'],
    ['Configuration', 'configuration'],
    ['Environment Variables', 'configuration'],
    ['.env', 'configuration'],
    ['API Reference', 'api'],
    ['Endpoints', 'api'],
    ['Running Tests', 'testing'],
    ['Testing', 'testing'],
    ['Deployment', 'deployment'],
    ['Deploy to Vercel', 'deployment'],
    ['Project Structure', 'structure'],
    ['Contributing', 'contributing'],
    ['License', 'license'],
    ['Licence', 'license'],
    ['Roadmap', 'roadmap'],
    ['API Keys', 'configuration'],
  ])('%s -> %s', (heading, expected) => {
    expect(classifySection(heading)).toBe(expected);
  });

  it('matches whole words only', () => {
    expect(classifySection('Latest news')).toBeNull();
    expect(classifySection('Rapid prototyping')).toBeNull();
    expect(classifySection('Technical background')).toBeNull();
  });

  it('returns null for empty or unknown headings', () => {
    expect(classifySection('')).toBeNull();
    expect(classifySection('   ')).toBeNull();
    expect(classifySection('Acknowledgements')).toBeNull();
    expect(classifySection(undefined as unknown as string)).toBeNull();
  });

  it('normalizeHeadingText strips emoji, numbering and punctuation', () => {
    expect(normalizeHeadingText('📦 2.1. Installation:')).toBe('installation');
    expect(normalizeHeadingText('Step 3: Run it!')).toBe('run it');
  });
});

describe('buildContext', () => {
  it('treats the first h1 as the title and does not classify it', () => {
    const ctx = ctxFor(md('# Awesome API Server', '', 'Intro', '', '## Installation', '', 'x'));
    expect(ctx.titleText).toBe('Awesome API Server');
    expect(ctx.blocks[1]!.section).toBeNull();
    expect(ctx.blocks[3]!.section).toBe('installation');
  });

  it('children inherit the parent section type', () => {
    const ctx = ctxFor(md('# T', '## Installation', '### Docker', 'text'));
    const docker = ctx.blocks.find((b) => b.headingText === 'Docker')!;
    expect(docker.section).toBe('installation');
    expect(ctx.blocks[3]!.headingPath).toEqual(['T', 'Installation', 'Docker']);
  });

  it('a child with its own type overrides the parent', () => {
    const ctx = ctxFor(md('# T', '## Getting Started', '### Prerequisites', '- Node 20'));
    expect(ctx.blocks[3]!.section).toBe('prerequisites');
  });

  it('a later sibling resets the section', () => {
    const ctx = ctxFor(md('# T', '## Features', '- a', '## License', 'MIT'));
    expect(ctx.blocks[2]!.section).toBe('features');
    expect(ctx.blocks[4]!.section).toBe('license');
  });

  it('recognises raw HTML headings', () => {
    const ctx = ctxFor(md('<h1 align="center">My App</h1>', '', '<h2>Features</h2>', '', '- fast'));
    expect(ctx.titleText).toBe('My App');
    expect(ctx.blocks[2]!.section).toBe('features');
  });

  it('records sections with own and effective types', () => {
    const ctx = ctxFor(md('# T', '## Usage', '### Advanced'));
    expect(ctx.sections).toEqual([
      expect.objectContaining({ text: 'Usage', ownType: 'usage', type: 'usage' }),
      expect.objectContaining({ text: 'Advanced', ownType: null, type: 'usage' }),
    ]);
    expect(hasSection(ctx, 'usage')).toBe(true);
    expect(hasSection(ctx, 'api')).toBe(false);
  });

  it('works on an empty document', () => {
    const ctx = buildContext(parseMarkdown('').mdast);
    expect(ctx.blocks).toEqual([]);
    expect(ctx.titleText).toBeNull();
  });

  it('blockText separates table cells and list items', () => {
    const { mdast } = parseMarkdown(md('| A | B |', '|---|---|', '| Database | PostgreSQL |'));
    expect(blockText(mdast.children[0])).toBe('A | B Database | PostgreSQL');
    const list = parseMarkdown(md('- one', '- two')).mdast.children[0];
    expect(blockText(list)).toBe('one two');
  });
});
