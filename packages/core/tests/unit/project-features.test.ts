import { describe, it, expect } from 'vitest';
import { extractProjectInfo, isBadgeUrl, countNonBadgeImages } from '../../src/extract/project';
import { extractFeatures } from '../../src/extract/features';
import { ctxFor, md, GITHUB, PASTE } from '../helpers';

const project = (markdown: string, source = PASTE) => extractProjectInfo(ctxFor(markdown, source), source);
const features = (markdown: string) => extractFeatures(ctxFor(markdown)).map((f) => f.value);

describe('extractProjectInfo', () => {
  it('name from the first h1', () => {
    const p = project(md('# TaskFlow', '', 'A board.'));
    expect(p.name).toMatchObject({ value: 'TaskFlow', confidence: 'explicit', source: { line: 1 } });
  });

  it('name from a raw HTML h1', () => {
    expect(project('<h1 align="center">  Fancy App </h1>').name?.value).toBe('Fancy App');
  });

  it('falls back to the repo name, then null', () => {
    expect(project('Just text', GITHUB).name).toMatchObject({ value: 'taskflow', confidence: 'inferred-rule' });
    expect(project('Just text').name).toBeNull();
  });

  it('strips emoji from the name', () => {
    expect(project('# 🚀 Rocket').name?.value).toBe('Rocket');
  });

  it('description skips badge-only paragraphs', () => {
    const p = project(
      md(
        '# App',
        '',
        '[![CI](https://github.com/a/b/actions/workflows/ci.yml/badge.svg)](https://github.com/a/b/actions) ![npm](https://img.shields.io/npm/v/x)',
        '',
        'The fastest way to ship docs.'
      )
    );
    expect(p.description).toMatchObject({ value: 'The fastest way to ship docs.', source: { line: 5 } });
  });

  it('description skips image-only paragraphs and alert blockquotes', () => {
    const p = project(md('# App', '', '![logo](logo.png)', '', '> [!NOTE]', '> Beta', '', 'Real description here.'));
    expect(p.description?.value).toBe('Real description here.');
  });

  it('description can come from a blockquote', () => {
    expect(project(md('# App', '', '> A tiny tool for big jobs.')).description?.value).toBe('A tiny tool for big jobs.');
  });

  it('description can come from an HTML paragraph', () => {
    expect(project(md('# App', '', '<p align="center">A centered description of the app.</p>')).description?.value).toBe('A centered description of the app.');
  });

  it('description is limited to 300 characters', () => {
    const long = 'word '.repeat(120);
    expect(project(md('# App', '', long)).description!.value.length).toBeLessThanOrEqual(301);
  });

  it('description is not taken from a later section', () => {
    expect(project(md('# App', '', '## Installation', '', 'Run the following command.')).description).toBeNull();
  });

  it('collects badges with their link', () => {
    const p = project(md('[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) ![photo](https://example.com/a.png)'));
    expect(p.badges).toEqual([{ alt: 'License', imageUrl: 'https://img.shields.io/badge/license-MIT-blue', linkUrl: 'LICENSE', line: 1 }]);
  });

  it('collects badges from HTML', () => {
    const p = project('<p><a href="https://x.dev"><img src="https://badgen.net/npm/v/x" alt="npm"></a></p>');
    expect(p.badges).toEqual([{ alt: 'npm', imageUrl: 'https://badgen.net/npm/v/x', linkUrl: 'https://x.dev', line: 1 }]);
  });

  it('empty input', () => {
    expect(project('')).toEqual({ name: null, description: null, badges: [] });
  });
});

describe('isBadgeUrl / countNonBadgeImages', () => {
  it('recognises known badge hosts', () => {
    for (const url of [
      'https://img.shields.io/badge/a-b-c',
      'https://badgen.net/x',
      'https://github.com/o/r/actions/workflows/ci.yml/badge.svg',
      'https://codecov.io/gh/o/r/branch/main/graph/badge.svg',
      'https://travis-ci.org/o/r.svg?branch=master',
      'https://vercel.com/button',
    ]) {
      expect(isBadgeUrl(url)).toBe(true);
    }
    expect(isBadgeUrl('https://example.com/screenshot.png')).toBe(false);
    expect(isBadgeUrl(null)).toBe(false);
  });

  it('counts screenshots but not badges', () => {
    const ctx = ctxFor(md('![b](https://img.shields.io/x)', '', '![shot](docs/shot.png)', '', '<img src="demo.gif">'));
    expect(countNonBadgeImages(ctx)).toBe(2);
  });
});

describe('extractFeatures', () => {
  it('list items under a Features heading', () => {
    expect(features(md('# A', '## Features', '- Fast', '- Typed', '- Tested'))).toEqual(['Fast', 'Typed', 'Tested']);
  });

  it('strips emoji, bold and leading bullets', () => {
    expect(features(md('## Features', '- ⚡ **Blazing** fast', '- ✅ Works offline'))).toEqual(['Blazing fast', 'Works offline']);
  });

  it('flattens one level of nested lists', () => {
    expect(features(md('## Features', '- Auth', '  - OAuth', '  - Magic links', '- Billing'))).toEqual(['Auth', 'OAuth', 'Magic links', 'Billing']);
  });

  it('accepts aliases like Highlights and Key Features', () => {
    expect(features(md('## Highlights', '- One'))).toEqual(['One']);
    expect(features(md('## Key Features', '* Two'))).toEqual(['Two']);
  });

  it('reads tables with a Feature column', () => {
    expect(features(md('## Features', '', '| Feature | Status |', '|---|---|', '| Sync | Done |', '| Export | WIP |'))).toEqual(['Sync', 'Export']);
  });

  it('ignores tables without a Feature column', () => {
    expect(features(md('## Features', '', '| Name | Status |', '|---|---|', '| Sync | Done |'))).toEqual([]);
  });

  it('falls back to sub-headings', () => {
    expect(features(md('## Features', '### Realtime', 'text', '### Offline', 'text'))).toEqual(['Realtime', 'Offline']);
  });

  it('returns [] without a Features section (never inferred)', () => {
    expect(features(md('# App', '- Fast', '- Typed'))).toEqual([]);
  });

  it('dedupes and skips empty items', () => {
    expect(features(md('## Features', '- Fast', '- fast', '- ', '- Other'))).toEqual(['Fast', 'Other']);
  });

  it('keeps a source line and heading path for every item', () => {
    const f = extractFeatures(ctxFor(md('# App', '## Features', '- Fast')));
    expect(f[0]).toMatchObject({ value: 'Fast', confidence: 'explicit', source: { line: 3, headingPath: ['App', 'Features'] } });
  });

  it('stops at the next section', () => {
    expect(features(md('## Features', '- Alpha', '## Installation', '- Beta'))).toEqual(['Alpha']);
  });
});
