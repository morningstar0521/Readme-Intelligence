import { describe, it, expect } from 'vitest';
import { renderToHtml, renderMdast } from '../../src/render/pipeline';
import { parseMarkdown } from '../../src/parse/parseMarkdown';
import { analyzeReadme } from '../../src/analyze';
import { transformAlert } from '../../src/render/alerts';
import type { Element } from 'hast';
import { GITHUB, GITHUB_SUBDIR, PASTE, md } from '../helpers';

/** Find the first tag string for an element name. */
const tag = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? '';

describe('GFM rendering (F-10)', () => {
  it('headings, emphasis, strikethrough, inline code and links', () => {
    const html = renderToHtml('## Title\n\n*em* **strong** ~~gone~~ `code` [a](https://a.dev)');
    expect(html).toMatch(/<h2[^>]*>Title<\/h2>/);
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>code</code>');
    expect(html).toMatch(/<a [^>]*href="https:\/\/a\.dev"/);
  });

  it('lists, nested lists and task lists', () => {
    const html = renderToHtml(md('- a', '  - b', '1. one', '', '- [x] done', '- [ ] todo'));
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toMatch(/<li class="task-list-item"[^>]*><input type="checkbox" checked disabled>/);
    expect(html).toMatch(/<input type="checkbox" disabled>/);
  });

  it('tables, blockquotes, rules and autolinks', () => {
    const html = renderToHtml(md('| a | b |', '|---|:-:|', '| 1 | 2 |', '', '> quote', '', '---', '', 'Visit www.example.com'));
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<hr');
    expect(html).toMatch(/<a [^>]*href="http:\/\/www\.example\.com"/);
  });

  it('fenced code keeps the language class for highlighting', () => {
    const html = renderToHtml('```ts\nconst a = 1;\n```');
    expect(tag(html, 'code')).toContain('class="language-ts"');
  });

  it('emoji shortcodes (F-17)', () => {
    expect(renderToHtml('Launch :rocket:')).toContain('🚀');
  });
});

describe('GitHub alerts (F-13)', () => {
  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])('%s', (type) => {
    const html = renderToHtml(`> [!${type}]\n> Body text`);
    expect(html).toContain(`markdown-alert-${type.toLowerCase()}`);
    expect(html).toContain('markdown-alert-title');
    expect(html).toContain('Body text');
    expect(html).not.toContain(`[!${type}]`);
  });

  it('a normal blockquote stays a blockquote', () => {
    expect(renderToHtml('> just a quote')).toContain('<blockquote');
  });

  it('a marker followed by text on the same line is not an alert', () => {
    expect(renderToHtml('> [!NOTE] inline text')).toContain('<blockquote');
  });

  it('transformAlert ignores non-blockquotes', () => {
    const el: Element = { type: 'element', tagName: 'div', properties: {}, children: [] };
    expect(transformAlert(el)).toBeNull();
  });
});

describe('heading slugs (F-15) and headings list', () => {
  it('ids match GitHub slugs, duplicates get suffixes', () => {
    const html = renderToHtml(md('## Getting Started', '## Getting Started', '## FAQ & Help!'));
    expect(html).toContain('id="getting-started"');
    expect(html).toContain('id="getting-started-1"');
    expect(html).toContain('id="faq--help"');
  });

  it('includes raw HTML headings with line numbers', () => {
    const { mdast } = parseMarkdown(md('<h1 align="center">Fancy</h1>', '', '## Next'));
    const { headings } = renderMdast(mdast, PASTE);
    expect(headings.map((h) => [h.text, h.depth, h.id])).toEqual([
      ['Fancy', 1, 'fancy'],
      ['Next', 2, 'next'],
    ]);
    expect(headings[1]!.line).toBe(3);
  });

  it('TOC keeps h1-h4 only', () => {
    const r = analyzeReadme(md('# A', '## B', '### C', '#### D', '##### E'), PASTE);
    expect(r.toc.map((t) => t.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('extractor anchors match the rendered heading ids', () => {
    const r = analyzeReadme(md('# App', '## Installation', '```bash', 'npm i', '```'), PASTE);
    expect(r.intelligence.commands[0]!.source.anchor).toBe('installation');
  });
});

describe('data-line attributes for jump to source', () => {
  it('block elements carry their source line', () => {
    const html = renderToHtml(md('# A', '', 'para', '', '- item'));
    expect(tag(html, 'h1')).toContain('data-line="1"');
    expect(tag(html, 'p')).toContain('data-line="3"');
    expect(tag(html, 'li')).toContain('data-line="5"');
  });
});

describe('URL resolution in rendered HTML (F-14)', () => {
  it('relative images and links resolve against GitHub', () => {
    const html = renderToHtml('![s](docs/shot.png) [g](docs/guide.md)', GITHUB);
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/taskflow/main/docs/shot.png"');
    expect(html).toContain('href="https://github.com/acme/taskflow/blob/main/docs/guide.md"');
  });

  it('resolves relative to a README in a sub directory', () => {
    const html = renderToHtml('<img src="./logo.svg">', GITHUB_SUBDIR);
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/taskflow/dev/packages/web/logo.svg"');
  });

  it('relative images in pasted Markdown are marked unavailable with the original path', () => {
    const img = tag(renderToHtml('![s](docs/shot.png)', PASTE), 'img');
    expect(img).not.toContain('src=');
    expect(img).toContain('data-unavailable="docs/shot.png"');
  });

  it('images are lazy loaded', () => {
    expect(tag(renderToHtml('![s](https://x.dev/a.png)'), 'img')).toContain('loading="lazy"');
  });

  it('badges render inline (F-16)', () => {
    const html = renderToHtml('[![CI](https://img.shields.io/badge/ci-passing-green)](https://ci.dev)');
    expect(html).toMatch(/<a [^>]*href="https:\/\/ci\.dev"[^>]*><img [^>]*src="https:\/\/img\.shields\.io/);
  });
});
