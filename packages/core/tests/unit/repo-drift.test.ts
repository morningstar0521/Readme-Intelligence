import { describe, it, expect } from 'vitest';
import { analyzeReadme } from '../../src/analyze';
import { checkRepository } from '../../src/repo/checks';
import { buildLocalSnapshot } from '../../src/repo/local';
import { diffRealityReports, shouldFail, renderRealityMarkdown, renderRealityText, DRIFT_COMMENT_MARKER } from '../../src/repo/drift';
import { buildGitHubSource } from '../../src/github/rawBase';
import type { RealityReport } from '../../src/repo/types';
import { md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');

/** Run the full local pipeline the CLI uses: file map -> snapshot -> analyze -> check. */
function runLocal(files: Record<string, string>, readmePath = 'README.md', ref = 'abc123'): RealityReport {
  const { snapshot } = buildLocalSnapshot({
    owner: 'acme',
    repo: 'app',
    ref,
    readmePath,
    entries: Object.entries(files).map(([path, text]) => ({ path, size: text.length })),
    readFile: (p) => files[p] ?? null,
  });
  const a = analyzeReadme(files[readmePath]!, buildGitHubSource('acme', 'app', ref, readmePath));
  return checkRepository({ intelligence: a.intelligence, hast: a.hast }, snapshot);
}

const README = md('# App', '', '## Setup', '', fence('bash', 'npm install', 'npm run dev', 'npm test'), '', 'See [docs](docs/guide.md).', '', '## License', '', 'MIT');

const BASE: Record<string, string> = {
  'README.md': README,
  'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite', test: 'vitest run', build: 'vite build' } }),
  'package-lock.json': '{}',
  'docs/guide.md': '# Guide',
  'src/index.ts': 'export const url = process.env.API_URL;',
  LICENSE: 'MIT License',
};

describe('buildLocalSnapshot', () => {
  it('selects files like the GitHub snapshot and reads them through the callback', () => {
    const read: string[] = [];
    const { snapshot, skipped } = buildLocalSnapshot({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      readmePath: './README.md',
      entries: [
        { path: 'package.json', size: 20 },
        { path: 'node_modules/x/index.js', size: 10 },
        { path: 'src\\app.ts', size: 10 },
        { path: 'big.lock', size: 10 },
        { path: 'LICENSE', size: 10 },
      ],
      readFile: (p) => {
        read.push(p);
        return p === 'LICENSE' ? null : 'x';
      },
    });
    expect(snapshot.baseDir).toBe('');
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.tree).toContain('src/app.ts');
    expect(Object.keys(snapshot.files)).toEqual(['package.json', 'src/app.ts']);
    expect(read).not.toContain('node_modules/x/index.js');
    expect(skipped).toEqual(['LICENSE']);
  });

  it('uses the README folder as base dir and enforces the byte budget and binary check', () => {
    const { snapshot, skipped } = buildLocalSnapshot({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      readmePath: 'web/README.md',
      entries: [
        { path: 'web/package.json', size: 5 },
        { path: 'package.json', size: 5 },
        { path: '.env.example', size: 5 },
      ],
      readFile: (p) => (p === '.env.example' ? 'A=\u0000' : p === 'package.json' ? 'y'.repeat(50) : 'xxxxx'),
      maxTotalBytes: 20,
    });
    expect(snapshot.baseDir).toBe('web');
    expect(Object.keys(snapshot.files)).toEqual(['web/package.json']);
    expect(skipped).toEqual(['.env.example', 'package.json']);
  });

  it('never throws when the reader throws', () => {
    const { skipped } = buildLocalSnapshot({ owner: 'o', repo: 'r', ref: 'm', readmePath: 'README.md', entries: [{ path: 'package.json', size: 1 }], readFile: () => { throw new Error('EACCES'); } });
    expect(skipped).toEqual(['package.json']);
  });
});

describe('diffRealityReports', () => {
  const base = runLocal(BASE);

  it('a clean base has no contradictions', () => {
    expect(base.claims.filter((c) => c.status === 'contradiction')).toEqual([]);
  });

  it('identical revisions produce an empty diff', () => {
    const d = diffRealityReports(base, runLocal(BASE));
    expect(d.newContradictions).toEqual([]);
    expect(d.resolvedContradictions).toEqual([]);
    expect(d.changes).toEqual([]);
    expect(d.readiness.delta).toBe(0);
  });

  // The PR renames the dev script and deletes the linked guide, but leaves the README alone: classic drift.
  const headFiles = { ...BASE, 'package.json': JSON.stringify({ name: 'app', scripts: { start: 'vite', test: 'vitest run' } }), 'src/index.ts': 'export const url = process.env.API_URL;\nexport const key = process.env.STRIPE_KEY;' };
  delete (headFiles as Record<string, string>)['docs/guide.md'];
  const head = runLocal(headFiles);
  const diff = diffRealityReports(base, head);

  it('reports contradictions introduced by the change', () => {
    const ids = diff.newContradictions.map((c) => c.id);
    expect(ids).toContain('script:dev');
    expect(ids).toContain('link:docs/guide.md');
    expect(diff.openContradictions).toEqual([]);
  });

  it('reports newly undocumented env vars and status changes', () => {
    expect(diff.newUndocumentedEnv.map((c) => c.id)).toContain('env:STRIPE_KEY');
    expect(diff.newUndocumentedEnv.map((c) => c.id)).not.toContain('env:API_URL');
    const devChange = diff.changes.find((c) => c.id === 'script:dev');
    expect(devChange).toMatchObject({ from: 'verified', to: 'contradiction' });
  });

  it('readiness drops and the delta is reported', () => {
    expect(diff.readiness.head).toBeLessThan(diff.readiness.base);
    expect(diff.readiness.delta).toBe(diff.readiness.head - diff.readiness.base);
  });

  it('reversing the comparison turns new contradictions into resolved ones', () => {
    const back = diffRealityReports(head, base);
    expect(back.newContradictions).toEqual([]);
    expect(back.resolvedContradictions.map((c) => c.id).sort()).toEqual(diff.newContradictions.map((c) => c.id).sort());
  });

  it('a contradiction on both sides is open, not new', () => {
    const again = diffRealityReports(head, runLocal(headFiles));
    expect(again.newContradictions).toEqual([]);
    expect(again.openContradictions.map((c) => c.id)).toContain('script:dev');
  });
});

describe('shouldFail', () => {
  const base = runLocal(BASE);
  const brokenFiles = { ...BASE, 'package.json': JSON.stringify({ name: 'app', scripts: { test: 'vitest run' } }) };
  const head = runLocal(brokenFiles);
  const diff = diffRealityReports(base, head);

  it('none never fails', () => {
    expect(shouldFail(head, diff, 'none').fail).toBe(false);
  });

  it('new-contradiction fails only on contradictions the change adds', () => {
    expect(shouldFail(head, diff, 'new-contradiction')).toMatchObject({ fail: true });
    expect(shouldFail(head, diffRealityReports(head, head), 'new-contradiction').fail).toBe(false);
  });

  it('without a base, new-contradiction behaves like contradiction', () => {
    expect(shouldFail(head, null, 'new-contradiction').fail).toBe(true);
    expect(shouldFail(base, null, 'contradiction').fail).toBe(false);
  });

  it('min readiness overrides', () => {
    const r = shouldFail(base, null, 'none', 101);
    expect(r.fail).toBe(true);
    expect(r.reason).toContain('below the minimum');
  });
});

describe('renderers', () => {
  const base = runLocal(BASE);
  const headFiles = { ...BASE, 'package.json': JSON.stringify({ name: 'app', scripts: { test: 'vitest run' } }) };
  const head = runLocal(headFiles);
  const diff = diffRealityReports(base, head);

  it('markdown carries the sticky-comment marker, the new contradiction and GitHub links', () => {
    const out = renderRealityMarkdown(head, diff, { readmePath: 'README.md', links: true });
    expect(out.startsWith(DRIFT_COMMENT_MARKER)).toBe(true);
    expect(out).toContain('### New contradictions in this change');
    expect(out).toContain('(https://github.com/acme/app/blob/abc123/README.md#L');
    expect(out).toMatch(/vs base/);
    expect(out).toContain('Nothing was installed or run');
  });

  it('markdown without links uses plain path:line and escapes table pipes', () => {
    const out = renderRealityMarkdown(head, null, { readmePath: 'README.md', links: false, title: 'Drift | check' });
    expect(out).not.toContain('https://github.com');
    expect(out).toContain('### Contradictions');
    expect(out).toMatch(/README:\d+/);
    expect(out).toContain('## Drift | check');
  });

  it('a clean change says so', () => {
    const out = renderRealityMarkdown(base, diffRealityReports(base, base), { readmePath: 'README.md', links: true });
    expect(out).toContain('No new contradictions');
  });

  it('text report lists the drift', () => {
    const out = renderRealityText(head, diff);
    expect(out).toMatch(/^Setup Readiness \d+\/100 \(-\d+ vs base\)/);
    expect(out).toContain('New contradictions:');
    expect(out).toContain('script:dev');
  });
});
