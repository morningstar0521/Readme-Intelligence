import { describe, it, expect } from 'vitest';
import { createSlugger, slugify } from '../../src/parse/slug';
import { buildToc } from '../../src/parse/toc';
import type { HeadingInfo } from '../../src/types';

describe('GitHub slugs', () => {
  it('lowercases and joins words with "-"', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
  });

  it('adds -1, -2 suffixes for duplicates', () => {
    const s = createSlugger();
    expect(s.slug('Foo')).toBe('foo');
    expect(s.slug('Foo')).toBe('foo-1');
    expect(s.slug('Foo')).toBe('foo-2');
  });

  it('drops punctuation but keeps "-" and "_"', () => {
    expect(slugify('What is this? (FAQ)')).toBe('what-is-this-faq');
    expect(slugify('snake_case-and-dash')).toBe('snake_case-and-dash');
  });

  it('drops emoji', () => {
    expect(slugify('🚀 Quick Start')).toBe('-quick-start');
  });

  it('keeps unicode letters', () => {
    expect(slugify('Über Café')).toBe('über-café');
  });

  it('handles inline code text in headings', () => {
    expect(slugify('The config.json file')).toBe('the-configjson-file');
  });

  it('reset clears duplicate tracking', () => {
    const s = createSlugger();
    s.slug('a');
    s.reset();
    expect(s.slug('a')).toBe('a');
  });

  it('keeps numbers', () => {
    expect(slugify('Step 2: Install v1.2')).toBe('step-2-install-v12');
  });
});

describe('buildToc', () => {
  const h = (depth: HeadingInfo['depth'], text: string, id = text.toLowerCase(), line = 1): HeadingInfo => ({ depth, text, id, line });

  it('keeps h1 to h4 in order', () => {
    const toc = buildToc([h(1, 'A'), h(2, 'B'), h(3, 'C'), h(4, 'D'), h(5, 'E'), h(6, 'F')]);
    expect(toc.map((t) => t.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps skipped levels as-is', () => {
    const toc = buildToc([h(1, 'Title'), h(3, 'Deep')]);
    expect(toc.map((t) => t.depth)).toEqual([1, 3]);
  });

  it('drops empty headings', () => {
    expect(buildToc([h(2, '   ', ''), h(2, 'Real')])).toHaveLength(1);
  });

  it('collapses whitespace', () => {
    expect(buildToc([h(2, 'A   B\n C', 'a-b-c')])[0]!.text).toBe('A B C');
  });

  it('keeps line numbers', () => {
    expect(buildToc([h(2, 'X', 'x', 42)])[0]!.line).toBe(42);
  });
});
