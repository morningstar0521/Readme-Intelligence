import { describe, it, expect } from 'vitest';
import {
  evaluate,
  loadFixtures,
  metricsFrom,
  setCounts,
  percentile,
  normalizeCommandLabel,
  normalizeTechLabel,
  normalizeEndpointLabel,
  renderResultsMarkdown,
  renderBenchmarkDashboard,
  evaluateReality,
  renderRealityEvalMarkdown,
  loadSnapshot,
  splitFixtures,
  LabelSchema,
  REGRESSION_FLOOR,
  type Fixture,
} from './evaluate';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SourceInfo } from '../../src/types';
import { readFixture, PASTE } from '../helpers';

/** Regression threshold from the test plan: fail if commands or env F1 drops below 0.80. */
const FLOOR = REGRESSION_FLOOR;

describe('metrics', () => {
  it('precision, recall and F1', () => {
    const m = metricsFrom(8, 2, 2);
    expect(m).toMatchObject({ tp: 8, fp: 2, fn: 2, precision: 0.8, recall: 0.8 });
    expect(m.f1).toBeCloseTo(0.8, 6);
    expect(metricsFrom(0, 0, 0).f1).toBeNull();
    expect(metricsFrom(0, 3, 0).f1).toBe(0);
    expect(metricsFrom(0, 0, 3).f1).toBe(0);
  });

  it('setCounts dedupes and lists misses', () => {
    expect(setCounts(['a', 'b', 'b'], ['b', 'c'])).toEqual({ tp: 1, fp: 1, fn: 1, fpItems: ['a'], fnItems: ['c'] });
  });

  it('percentile', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 95)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });

  it('normalisers', () => {
    expect(normalizeCommandLabel('$  npm   install ')).toBe('npm install');
    expect(normalizeCommandLabel('npx create-expo-app@latest')).toBe('npx create-expo-app');
    expect(normalizeCommandLabel('python -m pip install -U "pydantic"')).toBe('pip install pydantic');
    expect(normalizeCommandLabel("pip install 'transformers[torch]' --upgrade")).toBe('pip install transformers');
    expect(normalizeTechLabel('postgres')).toBe('postgresql');
    expect(normalizeTechLabel('SomethingNew')).toBe('somethingnew');
    expect(normalizeEndpointLabel('get /users/')).toBe('GET /users');
    expect(normalizeEndpointLabel('GET /')).toBe('GET /');
  });
});

describe('benchmark fixture split', () => {
  it('assigns fixtures deterministically with no overlap', () => {
    const fixtures = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((name) => ({ name } as Fixture));
    const first = splitFixtures(fixtures);
    const second = splitFixtures(fixtures);

    expect(first).toEqual(second);
    expect(new Set(first.development.map((fx) => fx.name)).size).toBe(first.development.length);
    expect(new Set(first.holdout.map((fx) => fx.name)).size).toBe(first.holdout.length);
    const holdoutNames = new Set(first.holdout.map((fx) => fx.name));
    expect(first.development.some((fx) => holdoutNames.has(fx.name))).toBe(false);
    expect(first.development.length + first.holdout.length).toBe(fixtures.length);
  });
});

describe('evaluate() on a synthetic labeled fixture', () => {
  const fixture: Fixture = {
    name: 'sample',
    markdown: readFixture('sample-readme.md'),
    source: PASTE,
    label: {
      labeled: true,
      commands: ['git clone https://github.com/acme/taskflow.git', 'cd taskflow', 'pnpm install', 'cp .env.example .env', 'docker compose up -d db', 'pnpm prisma migrate dev', 'pnpm dev', 'pnpm test', 'pnpm lint', 'vercel --prod'],
      envVars: ['DATABASE_URL', 'NEXTAUTH_SECRET', 'OPENAI_API_KEY', 'PORT', 'GITHUB_ID', 'SMTP_PASSWORD'],
      techStack: ['Next.js', 'React', 'Tailwind CSS', 'Node.js', 'Express', 'PostgreSQL', 'Prisma', 'NextAuth.js', 'Docker'],
      installSteps: 4,
      hasLicense: true,
      apiEndpoints: ['GET /api/tasks', 'POST /api/tasks', 'DELETE /api/tasks/:id'],
    },
  };

  it('computes perfect recall on the sample and writes a report', () => {
    const report = evaluate([fixture]);
    expect(report.fields.commands.recall).toBe(1);
    expect(report.fields.envVars.f1).toBe(1);
    expect(report.fields.apiEndpoints.f1).toBe(1);
    expect(report.fields.techStack.recall).toBe(1);
    expect(report.installSteps.exact).toBe(1);
    expect(report.license.accuracy).toBe(1);
    const mdReport = renderResultsMarkdown(report, { date: '2026-01-01', totalFixtures: 1, unlabeled: 0, nodeVersion: 'test' });
    expect(mdReport).toContain('| commands |');
    expect(mdReport).toContain('Parse + extract p95');
    expect(renderResultsMarkdown(report, { date: '2026-01-01', totalFixtures: 1, unlabeled: 0, nodeVersion: 'test' }, undefined, report)).toContain('## Holdout accuracy');
    expect(renderBenchmarkDashboard(report, { date: '2026-01-01', nodeVersion: 'test' })).toContain('Highest-impact failure examples');
  });
});

describe('Reality Check eval', () => {
  const source: SourceInfo = { kind: 'github', owner: 'acme', repo: 'app', ref: 'main', path: 'README.md', rawBase: 'https://raw.githubusercontent.com/acme/app/main/', htmlUrl: 'https://github.com/acme/app' };
  const markdown = ['# App', '', '## Usage', '', '```bash', 'npm install', 'npm run lint', 'npm start', '```', '', '## License', '', 'MIT', ''].join('\n');
  const files = {
    'package.json': JSON.stringify({ name: 'app', scripts: { start: 'node index.js', test: 'node --test' } }),
    'index.js': 'const dsn = process.env.SENTRY_DSN;\nconst port = process.env.API_PORT;',
    LICENSE: 'MIT License',
  };
  const snapshot = { owner: 'acme', repo: 'app', ref: 'main', baseDir: '', tree: [...Object.keys(files), 'package-lock.json'], truncated: false, files };
  const base: Fixture = {
    name: 'acme__app',
    markdown,
    source,
    snapshot,
    label: LabelSchema.parse({ labeled: true, commands: [], envVars: [], techStack: [], installSteps: 0, hasLicense: true }),
  };

  it('label schema accepts an optional reality block with defaults', () => {
    expect(base.label.reality).toBeUndefined();
    const l = LabelSchema.parse({ labeled: true, commands: [], envVars: [], techStack: [], installSteps: 0, hasLicense: false, reality: { labeled: true } });
    expect(l.reality).toEqual({ labeled: true, contradictions: [], undocumentedEnv: [] });
  });

  it('unlabeled reality fixtures count toward readiness and status totals only', () => {
    const r = evaluateReality([base, { ...base, name: 'no-snapshot', snapshot: undefined }]);
    expect(r.withSnapshot).toBe(1);
    expect(r.labeled).toBe(0);
    expect(r.contradictions.f1).toBeNull();
    expect(r.meanReadiness).not.toBeNull();
    expect(r.statusTotals.contradiction).toBeGreaterThanOrEqual(1);
    expect(renderRealityEvalMarkdown(r).join('\n')).toContain('not reported yet');
  });

  it('computes precision and recall against hand labels', () => {
    const fx: Fixture = { ...base, label: { ...base.label, reality: { labeled: true, contradictions: ['script:lint', 'runtime:node'], undocumentedEnv: ['SENTRY_DSN'] } } };
    const r = evaluateReality([fx]);
    expect(r.labeled).toBe(1);
    expect(r.contradictions).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(r.undocumentedEnv).toMatchObject({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
    expect(r.perFixture[0]!.misses.contradictions.fn).toEqual(['runtime:node']);
    expect(r.perFixture[0]!.misses.undocumentedEnv.fp).toEqual(['API_PORT']);
    const out = renderRealityEvalMarkdown(r).join('\n');
    expect(out).toContain('| Contradictions | 1 | 0 | 1 |');
    expect(out).toContain('| Undocumented env vars | 1 | 1 | 0 |');
  });

  it('report says how to start when there are no snapshots', () => {
    expect(renderRealityEvalMarkdown(evaluateReality([{ ...base, snapshot: undefined }])).join('\n')).toContain('--with-repo');
  });

  it('loadSnapshot ignores missing and invalid files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ri-snap-'));
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(snapshot));
    writeFileSync(bad, '{"owner": 1');
    expect(loadSnapshot(good)?.files['index.js']).toContain('SENTRY_DSN');
    expect(loadSnapshot(bad)).toBeUndefined();
    expect(loadSnapshot(path.join(dir, 'missing.json'))).toBeUndefined();
  });
});

describe('fixture set regression (runs only when hand-labeled fixtures exist)', () => {
  const { fixtures, total, unlabeled } = loadFixtures();

  it('reports fixture status', () => {
    // Informational: the fetch + labelling workflow is documented in docs/LABELING.md.
    expect(total).toBeGreaterThanOrEqual(fixtures.length);
    expect(unlabeled.length).toBe(total - fixtures.length);
  });

  it.skipIf(fixtures.length === 0)(`commands and env vars F1 stay at or above the regression floor (${FLOOR.commands} / ${FLOOR.envVars})`, () => {
    const report = evaluate(fixtures);
    expect(report.fields.commands.f1 ?? 0).toBeGreaterThanOrEqual(FLOOR.commands);
    expect(report.fields.envVars.f1 ?? 0).toBeGreaterThanOrEqual(FLOOR.envVars);
  });
});
