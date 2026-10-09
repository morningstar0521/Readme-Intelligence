import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SourceInfo } from '../src/types';
import { parseMarkdown } from '../src/parse/parseMarkdown';
import { renderMdast } from '../src/render/pipeline';
import { buildContext, type DocContext } from '../src/extract/context';

export const PASTE: SourceInfo = { kind: 'paste' };

export const GITHUB: SourceInfo = {
  kind: 'github',
  owner: 'acme',
  repo: 'taskflow',
  ref: 'main',
  path: 'README.md',
  rawBase: 'https://raw.githubusercontent.com/acme/taskflow/main/',
  htmlUrl: 'https://github.com/acme/taskflow/blob/main/README.md',
};

export const GITHUB_SUBDIR: SourceInfo = {
  kind: 'github',
  owner: 'acme',
  repo: 'taskflow',
  ref: 'dev',
  path: 'packages/web/README.md',
  rawBase: 'https://raw.githubusercontent.com/acme/taskflow/dev/packages/web/',
  htmlUrl: 'https://github.com/acme/taskflow/blob/dev/packages/web/README.md',
};

/** Parse + render + build the extractor context, like analyzeReadme does. */
export function ctxFor(markdown: string, source: SourceInfo = PASTE): DocContext {
  const { mdast } = parseMarkdown(markdown);
  const { headings } = renderMdast(mdast, source);
  return buildContext(mdast, headings);
}

/** Join lines with "\n" (keeps test Markdown readable without template indentation issues). */
export function md(...lines: string[]): string {
  return lines.join('\n');
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function readFixture(name: string): string {
  return readFileSync(path.join(here, 'fixtures', name), 'utf8');
}
