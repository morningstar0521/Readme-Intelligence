import { describe, it, expect } from 'vitest';
import { extractInstallSteps, extractPrerequisites, looksLikePrerequisite } from '../../src/extract/install';
import { extractCommands } from '../../src/extract/commands';
import { ctxFor, md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');
const steps = (markdown: string) => {
  const ctx = ctxFor(markdown);
  return extractInstallSteps(ctx, extractCommands(ctx));
};
const prereqs = (markdown: string) => extractPrerequisites(ctxFor(markdown)).map((p) => p.value);

describe('extractPrerequisites', () => {
  it('list items in a Prerequisites section', () => {
    expect(prereqs(md('## Prerequisites', '- Node.js 20+', '- pnpm', '- A GitHub account'))).toEqual(['Node.js 20+', 'pnpm', 'A GitHub account']);
  });

  it('Requirements alias and nested Prerequisites under Getting Started', () => {
    expect(prereqs(md('## Requirements', '* Python >= 3.10'))).toEqual(['Python >= 3.10']);
    expect(prereqs(md('## Getting Started', '### Prerequisites', '- Docker'))).toEqual(['Docker']);
  });

  it('tool + version lines in Prerequisites paragraphs', () => {
    expect(prereqs(md('## Prerequisites', '', 'You need Node.js 18 or later.', 'Also some free time.'))).toEqual(['You need Node.js 18 or later.']);
  });

  it('tool + version list items in Installation sections', () => {
    expect(prereqs(md('## Installation', '- PostgreSQL 14', '- Clone the repo and enjoy the ride with friends', fence('bash', 'npm i')))).toEqual(['PostgreSQL 14']);
  });

  it('requirement sentences in Installation paragraphs', () => {
    expect(prereqs(md('## Installation', '', 'Make sure you have Python 3.11 installed.'))).toEqual(['Make sure you have Python 3.11 installed.']);
    expect(prereqs(md('## Quick start', '', 'Requirements: Node.js 20+, pnpm 9+.'))).toEqual(['Requirements: Node.js 20+, pnpm 9+.']);
    expect(prereqs(md('## Installation', '', 'Node.js 20 is used by the build.'))).toEqual([]);
  });

  it('rows of a requirements table', () => {
    expect(prereqs(md('## Prerequisites', '', '| Tool | Version |', '|---|---|', '| Go | 1.22 |'))).toEqual(['Go 1.22']);
  });

  it('returns [] when there is nothing', () => {
    expect(prereqs(md('# App', 'Hello'))).toEqual([]);
  });

  it('looksLikePrerequisite', () => {
    for (const t of ['Node.js 18+', 'Python >= 3.10', 'Docker', 'Java 17', 'PostgreSQL 14', 'Go 1.22', 'node v20 (LTS)', 'Rust (latest)']) {
      expect(looksLikePrerequisite(t)).toBe(true);
    }
    expect(looksLikePrerequisite('Clone the repository')).toBe(false);
  });

  it('keeps source refs', () => {
    const [p] = extractPrerequisites(ctxFor(md('# A', '## Prerequisites', '- Docker')));
    expect(p).toMatchObject({ source: { line: 3, headingPath: ['A', 'Prerequisites'] }, confidence: 'explicit' });
  });
});

describe('extractInstallSteps', () => {
  it('ordered list items with nested code are steps', () => {
    const s = steps(md('## Installation', '1. Clone', '   ```bash', '   git clone https://github.com/a/b', '   ```', '2. Install', '   ```bash', '   npm install', '   ```'));
    expect(s.map((x) => [x.order, x.title, x.commands])).toEqual([
      [1, 'Clone', ['git clone https://github.com/a/b']],
      [2, 'Install', ['npm install']],
    ]);
  });

  it('ordered list items followed by an unindented code block', () => {
    const s = steps(md('## Installation', '', '1. Install dependencies:', '', fence('bash', 'npm ci'), '', '2. Start:', '', fence('bash', 'npm start')));
    expect(s.map((x) => [x.title, x.commands])).toEqual([
      ['Install dependencies', ['npm ci']],
      ['Start', ['npm start']],
    ]);
  });

  it('ordered list items without commands are kept', () => {
    expect(steps(md('## Installation', '1. Download the release', '2. Unzip it')).map((x) => x.title)).toEqual(['Download the release', 'Unzip it']);
  });

  it('sub-headings with code blocks are steps, and several blocks merge into one step', () => {
    const s = steps(md('## Installation', '### Backend', 'Install:', fence('bash', 'pip install -r requirements.txt'), 'Run:', fence('bash', 'uvicorn main:app'), '### Frontend', fence('bash', 'npm i')));
    expect(s.map((x) => [x.title, x.commands])).toEqual([
      ['Backend', ['pip install -r requirements.txt', 'uvicorn main:app']],
      ['Frontend', ['npm i']],
    ]);
  });

  it('only code blocks: one step per block, titled by the paragraph before it', () => {
    const s = steps(md('## Getting Started', '', 'Clone the repo:', '', fence('bash', 'git clone x'), '', fence('sh', 'cd x && make')));
    expect(s.map((x) => [x.order, x.title, x.commands])).toEqual([
      [1, 'Clone the repo', ['git clone x']],
      [2, null, ['cd x && make']],
    ]);
  });

  it('paragraphs with inline commands are steps', () => {
    expect(steps(md('## Install', '', 'Run `pip install mypkg` to install.')).map((x) => x.commands)).toEqual([['pip install mypkg']]);
  });

  it('ignores non-command code blocks (env files, JSON)', () => {
    expect(steps(md('## Installation', fence('env', 'PORT=3000'), fence('json', '{}')))).toEqual([]);
  });

  it('heading sub-steps with no commands are dropped', () => {
    expect(steps(md('## Installation', '### Notes', 'Read carefully.'))).toEqual([]);
  });

  it('fallback: no Installation section, setup commands elsewhere', () => {
    const s = steps(md('# App', '## Usage', fence('bash', 'npm install', 'npm start')));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ title: 'Inferred install steps', commands: ['npm install'], confidence: 'inferred-rule' });
  });

  it('no fallback when an Installation section exists', () => {
    expect(steps(md('## Installation', 'Coming soon.', '## Usage', fence('bash', 'npm install')))).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(steps('')).toEqual([]);
  });

  it('steps keep source lines', () => {
    const [s] = steps(md('# A', '## Installation', '1. Do it'));
    expect(s!.source).toMatchObject({ line: 3, headingPath: ['A', 'Installation'] });
  });
});
