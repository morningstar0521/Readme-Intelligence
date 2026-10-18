import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { analyzeReadme } from '../../src/analyze';
import { checkRepository, scriptReference, referencedPaths, licenseFamily } from '../../src/repo/checks';
import { READINESS_TOTAL_WEIGHT } from '../../src/repo/readiness';
import { fetchRepoSnapshot } from '../../src/repo/fetchRepo';
import { selectRepoFiles } from '../../src/repo/select';
import type { RepoSnapshot, RealityReport, ClaimStatus } from '../../src/repo/types';
import type { SourceInfo } from '../../src/types';
import type { FetchLike } from '../../src/github/fetchReadme';
import { md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');

function snapshot(files: Record<string, string>, extraTree: string[] = [], opts: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { owner: 'acme', repo: 'app', ref: 'main', baseDir: '', tree: [...Object.keys(files), ...extraTree], truncated: false, files, ...opts };
}

const SOURCE: SourceInfo = { kind: 'github', owner: 'acme', repo: 'app', ref: 'main', path: 'README.md', rawBase: 'https://raw.githubusercontent.com/acme/app/main/', htmlUrl: 'https://github.com/acme/app' };

function run(readme: string, snap: RepoSnapshot, hast?: HastRoot): RealityReport {
  const a = analyzeReadme(readme, SOURCE);
  return checkRepository({ intelligence: a.intelligence, hast: hast ?? a.hast }, snap);
}

const status = (r: RealityReport, id: string): ClaimStatus | undefined => r.claims.find((c) => c.id === id)?.status;

// ------------------------------------------------------------------ a consistent Node project

const NODE_README = md(
  '# App',
  '',
  'A task board.',
  '',
  '## Tech Stack',
  '',
  '- Next.js',
  '- PostgreSQL',
  '- Prisma',
  '',
  '## Prerequisites',
  '',
  '- Node.js 20+',
  '',
  '## Installation',
  '',
  fence('bash', 'pnpm install', 'cp .env.example .env', 'pnpm dev'),
  '',
  '## Configuration',
  '',
  fence('env', 'DATABASE_URL=postgres://localhost/app', 'OLD_SETTING=1'),
  '',
  '## Testing',
  '',
  fence('bash', 'pnpm test'),
  '',
  'See the [guide](docs/guide.md).',
  '',
  '## License',
  '',
  'MIT'
);

const NODE_REPO = snapshot(
  {
    'package.json': JSON.stringify(
      { name: 'app', engines: { node: '>=20' }, scripts: { dev: 'next dev', test: 'vitest run', build: 'next build' }, dependencies: { next: '14', '@prisma/client': '5', pg: '8', stripe: '14' }, devDependencies: { prisma: '5', vitest: '2' } },
      null,
      2
    ),
    '.env.example': md('DATABASE_URL=', 'STRIPE_SECRET_KEY='),
    'src/lib/stripe.ts': 'export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);',
    'docker-compose.yml': md('services:', '  db:', '    image: postgres:16'),
    '.github/workflows/ci.yml': md('jobs:', '  t:', '    steps:', '      - uses: pnpm/action-setup@v4', '      - run: pnpm install', '      - run: pnpm test'),
    LICENSE: 'MIT License\n\nCopyright (c) 2026',
  },
  ['pnpm-lock.yaml', 'docs/guide.md', 'CONTRIBUTING.md']
);

describe('checkRepository: consistent Node project', () => {
  const r = run(NODE_README, NODE_REPO);

  it('verifies scripts, package manager, runtime, license, links and referenced files', () => {
    expect(status(r, 'script:dev')).toBe('verified');
    expect(status(r, 'script:test')).toBe('verified');
    expect(status(r, 'pm:node')).toBe('verified');
    expect(status(r, 'runtime:node')).toBe('verified');
    expect(status(r, 'license')).toBe('verified');
    expect(status(r, 'link:docs/guide.md')).toBe('verified');
    expect(status(r, 'file:.env.example')).toBe('verified');
    expect(status(r, 'ci:tests')).toBe('verified');
  });

  it('verifies tech claims against dependencies and compose images', () => {
    expect(status(r, 'tech:Next.js')).toBe('verified');
    expect(status(r, 'tech:Prisma')).toBe('verified');
    const pg = r.claims.find((c) => c.id === 'tech:PostgreSQL')!;
    expect(pg.status).toBe('verified');
    expect(pg.repo.map((e) => e.path)).toEqual(expect.arrayContaining(['package.json', 'docker-compose.yml']));
  });

  it('finds env vars: verified, documented-but-unused, and used-but-undocumented', () => {
    expect(status(r, 'env:DATABASE_URL')).toBe('verified');
    expect(status(r, 'env:OLD_SETTING')).toBe('readme-only');
    const stripe = r.claims.find((c) => c.id === 'env:STRIPE_SECRET_KEY')!;
    expect(stripe.status).toBe('repo-only');
    expect(stripe.repo.map((e) => e.path).sort()).toEqual(['.env.example', 'src/lib/stripe.ts']);
  });

  it('lists undocumented repository facts', () => {
    expect(status(r, 'contributing')).toBe('repo-only');
    expect(status(r, 'docker:undocumented')).toBe('repo-only');
  });

  it('has no contradictions', () => {
    expect(r.counts.contradiction).toBe(0);
  });

  it('links evidence to exact GitHub lines', () => {
    const dev = r.claims.find((c) => c.id === 'script:dev')!;
    expect(dev.repo[0]).toMatchObject({ kind: 'content', path: 'package.json', line: expect.any(Number) });
    expect(dev.readme[0]!.line).toBeGreaterThan(0);
  });

  it('computes a Setup Readiness score with weights summing to 100', () => {
    expect(READINESS_TOTAL_WEIGHT).toBe(100);
    const failed = r.readiness.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(['R07', 'R08']);
    expect(r.readiness.score).toBe(85);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run(NODE_README, NODE_REPO).claims)).toBe(JSON.stringify(r.claims));
  });
});

// ------------------------------------------------------------------ contradictions

const BAD_README = md(
  '# App',
  '',
  '## Prerequisites',
  '',
  '- Node.js 16',
  '',
  '## Installation',
  '',
  fence('bash', 'git clone https://github.com/acme/app', 'cd app', 'npm install', 'cp .env.sample .env', 'npm run start:dev', 'make seed', 'docker compose up', 'cd server'),
  '',
  'Read [the old guide](docs/old-guide.md).',
  '',
  '## License',
  '',
  'Apache License 2.0'
);

const BAD_REPO = snapshot(
  {
    'package.json': JSON.stringify({ scripts: { dev: 'node index.js' }, engines: { node: '>=20' } }, null, 2),
    Makefile: md('build:', '\tgo build'),
    LICENSE: 'MIT License',
    '.nvmrc': '20',
  },
  ['pnpm-lock.yaml', 'index.js']
);

describe('checkRepository: contradictions', () => {
  const r = run(BAD_README, BAD_REPO);

  it.each([
    ['pm:node', 'npm vs pnpm-lock.yaml'],
    ['script:start:dev', 'missing script'],
    ['runtime:node', 'Node 16 vs engines >=20'],
    ['file:.env.sample', 'missing file in cp'],
    ['make:seed', 'missing make target'],
    ['docker:compose', 'compose command without compose file'],
    ['link:docs/old-guide.md', 'broken link'],
    ['license', 'Apache vs MIT'],
    ['file:server', 'cd into a missing folder'],
  ])('%s is a contradiction (%s)', (id) => {
    expect(status(r, id)).toBe(['pm:node', 'docker:compose', 'file:.env.sample', 'link:docs/old-guide.md', 'file:server'].includes(id) ? 'unverified' : 'contradiction');
  });

  it('does not flag `cd <repo name>` after git clone', () => {
    expect(status(r, 'file:app')).toBeUndefined();
  });

  it('contradictions come first and lower the readiness score', () => {
    expect(r.claims[0]!.status).toBe('contradiction');
    const failed = r.readiness.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(['R05', 'R06', 'R10']));
  });

  it('runtime contradiction names both sources', () => {
    const c = r.claims.find((x) => x.id === 'runtime:node')!;
    expect(c.detail).toContain('package.json requires >=20');
    // .nvmrc pins 20, which is above the README minimum of 16, so it is not part of the conflict.
    expect(c.detail).not.toContain('.nvmrc');
  });

  it('a version file pinned below the README minimum is a contradiction', () => {
    const r = run(md('# A', '## Prerequisites', '- Node.js 20+'), snapshot({ '.nvmrc': '18.19.0' }));
    const c = r.claims.find((x) => x.id === 'runtime:node')!;
    expect(c.status).toBe('contradiction');
    expect(c.detail).toContain('.nvmrc pins 18.19.0');
  });
});

// ------------------------------------------------------------------ Python

describe('checkRepository: Python project', () => {
  const readme = md('# Api', '', '## Built With', '', '- FastAPI', '- MongoDB', '', '## Requirements', '', '- Python 3.8+', '', '## Setup', '', fence('bash', 'pip install -r requirements-dev.txt', 'uvicorn main:app'));
  const repo = snapshot(
    {
      'pyproject.toml': md('[project]', 'requires-python = ">=3.10"', 'dependencies = ["fastapi", "uvicorn"]', '', '[project.optional-dependencies]', 'dev = ["pytest"]'),
      'main.py': md('import os', 'key = os.getenv("OPENAI_API_KEY")'),
    },
    ['uv.lock']
  );
  const r = run(readme, repo);

  it('checks runtime, tech, files and env', () => {
    expect(status(r, 'runtime:python')).toBe('contradiction');
    expect(status(r, 'tech:FastAPI')).toBe('verified');
    expect(status(r, 'tech:MongoDB')).toBe('readme-only');
    expect(status(r, 'file:requirements-dev.txt')).toBe('unverified');
    expect(status(r, 'env:OPENAI_API_KEY')).toBe('repo-only');
  });

  it('readiness: lockfile and pytest pass, undocumented env fails', () => {
    const byId = Object.fromEntries(r.readiness.checks.map((c) => [c.id, c.passed]));
    expect(byId).toMatchObject({ R01: true, R03: true, R06: true, R07: false });
  });
});

// ------------------------------------------------------------------ precision guards

describe('checkRepository: precision guards', () => {
  it('does not call a missing README path a contradiction in one snapshot', () => {
    expect(status(run(md('# A', 'See [the guide](docs/missing.md).'), snapshot({}, ['docs/other.md'])), 'link:docs/missing.md')).toBe('unverified');
    expect(status(run(md('# A', fence('bash', 'cd backend')), snapshot({})), 'file:backend')).toBe('unverified');
  });

  it('requires explicit values on both sides for contradictions', () => {
    expect(status(run(md('# A', fence('bash', 'pnpm lint')), snapshot({ 'package.json': '{"scripts":{}}' })), 'script:lint')).toBe('contradiction');
    expect(status(run(md('# A', 'See [the guide](docs/missing.md).'), snapshot({}, ['docs/other.md'])), 'link:docs/missing.md')).toBe('unverified');
    expect(status(run(md('# A', 'See [the guide](docs/missing.md).'), snapshot({}, [], { truncated: true })), 'link:docs/missing.md')).not.toBe('contradiction');
    expect(status(run(md('# A', fence('bash', 'npm install')), snapshot({ 'package.json': '{}' }, ['pnpm-lock.yaml'])), 'pm:node')).toBe('unverified');
    const withLockfileContent = run(md('# A', fence('bash', 'npm install')), snapshot({ 'package.json': '{}', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }));
    expect(status(withLockfileContent, 'pm:node')).toBe('contradiction');
    expect(status(run(md('# A', '## Prerequisites', '- Node.js 16+'), snapshot({ 'package.json': '{\n  "engines": { "node": ">=20" }\n}' })), 'runtime:node')).toBe('contradiction');
  });

  it('a truncated tree never produces "missing file" or broken-link contradictions', () => {
    const r = run(BAD_README, { ...BAD_REPO, truncated: true });
    for (const id of ['file:.env.sample', 'link:docs/old-guide.md', 'docker:compose', 'file:server']) expect(status(r, id)).not.toBe('contradiction');
  });

  it('workspace-scoped scripts are unverified, not contradictions', () => {
    const r = run(md('# A', fence('bash', 'pnpm --filter web dev')), snapshot({ 'package.json': '{"scripts":{"build":"turbo build"}}' }));
    expect(status(r, 'script:dev')).toBe('unverified');
  });

  it('pnpm/yarn/bun shorthand that names a package binary is not a missing script', () => {
    const pkg = snapshot({ 'package.json': JSON.stringify({ scripts: {}, devDependencies: { prisma: '5' } }) });
    expect(status(run(md('# A', fence('bash', 'pnpm prisma migrate dev')), pkg), 'script:prisma')).toBe('verified');
    expect(status(run(md('# A', fence('bash', 'yarn tsx scripts/a.ts')), pkg), 'script:tsx')).toBe('unverified');
    // Common script names are unverified without an explicit script value.
    expect(status(run(md('# A', fence('bash', 'pnpm lint')), pkg), 'script:lint')).toBe('contradiction');
  });

  it('does not treat dependency license prose as the project license', () => {
    const readme = md('# Hugo', '## License', '', 'For the Hugo source code, see [LICENSE](/LICENSE).', '', '- libwebp, BSD-3-Clause license');
    const r = run(readme, snapshot({ LICENSE: 'Apache License, Version 2.0' }));
    expect(r.claims.find((claim) => claim.id === 'license')).not.toMatchObject({ status: 'contradiction' });
  });

  it('a missing vercel.json does not make Vercel "README only"', () => {
    const r = run(md('# A', '## Tech Stack', '- Vercel', '- Docker'), snapshot({}, ['compose.yaml']));
    expect(status(r, 'tech:Vercel')).toBeUndefined();
    expect(status(r, 'tech:Docker')).toBe('verified');
  });

  it('env vars stay unverified until there is enough evidence', () => {
    const readme = md('# A', fence('env', 'API_URL=https://x.dev'));
    expect(status(run(readme, snapshot({ 'src/a.ts': 'x' })), 'env:API_URL')).toBe('unverified');
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`src/m${i}.ts`, 'export {}']));
    expect(status(run(readme, snapshot(many)), 'env:API_URL')).toBe('readme-only');
  });

  it('scripts without any package.json are unverified', () => {
    expect(status(run(md('# A', fence('bash', 'npm run dev')), snapshot({})), 'script:dev')).toBe('unverified');
  });

  it('README naming both npm and yarn is not a contradiction with yarn.lock', () => {
    const r = run(md('# A', fence('bash', 'npm install', 'yarn install')), snapshot({ 'package.json': '{}' }, ['yarn.lock']));
    expect(status(r, 'pm:node')).toBe('verified');
  });

  it('global installs do not count as the project manager', () => {
    const r = run(md('# A', fence('bash', 'npm install -g vercel', 'pnpm install')), snapshot({ 'package.json': '{}' }, ['pnpm-lock.yaml']));
    expect(status(r, 'pm:node')).toBe('verified');
  });

  it('files the README creates first are not reported missing', () => {
    const r = run(md('# A', fence('bash', 'mkdir data', 'cd data')), snapshot({}));
    expect(status(r, 'file:data')).toBeUndefined();
  });

  it('broken images are found in the rendered tree', () => {
    const hast: HastRoot = { type: 'root', children: [{ type: 'element', tagName: 'img', properties: { src: 'https://raw.githubusercontent.com/acme/app/main/docs/shot.png', dataLine: 7 }, children: [] }] };
    const r = run('# A', snapshot({}, ['docs/other.png']), hast);
    const c = r.claims.find((x) => x.id === 'image:docs/shot.png')!;
    expect(c.status).toBe('unverified');
    expect(c.readme[0]!.line).toBe(7);
  });

  it('a docs-only repository gets "not applicable" readiness passes, not failures', () => {
    const r = run(md('# Awesome list', '', '- [a](https://a.dev)'), snapshot({}, ['README.md']));
    const byId = Object.fromEntries(r.readiness.checks.map((c) => [c.id, c.passed]));
    expect(byId).toMatchObject({ R01: true, R02: true, R03: true, R04: true, R05: true, R06: true });
  });
});

describe('helpers', () => {
  it.each([
    ['npm run build', 'build'],
    ['npm test', 'test'],
    ['npm start', 'start'],
    ['pnpm dev', 'dev'],
    ['yarn lint:fix', 'lint:fix'],
    ['bun run dev', 'dev'],
    ['yarn workspace web dev', 'dev'],
  ])('scriptReference(%s) -> %s', (cmd, script) => {
    expect(scriptReference(cmd)?.script).toBe(script);
  });

  it('scriptReference ignores built-ins and non-managers', () => {
    for (const cmd of ['npm install', 'pnpm add zod', 'yarn', 'npx prisma generate', 'npm ci', 'pnpm dlx shadcn add button', 'bun index.ts', 'git status']) expect(scriptReference(cmd)).toBeNull();
    expect(scriptReference('pnpm -r build')?.workspaceScoped).toBe(true);
  });

  it('referencedPaths', () => {
    expect(referencedPaths('cp .env.example .env')).toEqual([{ path: '.env.example', kind: 'file' }]);
    expect(referencedPaths('pip install -r requirements/dev.txt')).toEqual([{ path: 'requirements/dev.txt', kind: 'file' }]);
    expect(referencedPaths('docker compose -f docker/dev.yml up')).toEqual([{ path: 'docker/dev.yml', kind: 'file' }]);
    expect(referencedPaths('python scripts/seed.py --n 10')).toEqual([{ path: 'scripts/seed.py', kind: 'file' }]);
    expect(referencedPaths('node dist/index.js')).toEqual([]);
    expect(referencedPaths('cd $HOME/app')).toEqual([]);
    expect(referencedPaths('cd backend')).toEqual([{ path: 'backend', kind: 'dir' }]);
  });

  it('licenseFamily', () => {
    expect(licenseFamily('MIT License')).toBe('mit');
    expect(licenseFamily('Apache License Version 2.0')).toBe('apache');
    expect(licenseFamily('GNU AFFERO GENERAL PUBLIC LICENSE')).toBe('agpl');
    expect(licenseFamily('GPL-3.0')).toBe('gpl');
    expect(licenseFamily('BSD-3-Clause')).toBe('bsd');
    expect(licenseFamily(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ fetching

describe('fetchRepoSnapshot', () => {
  const tree = { truncated: false, tree: [{ path: 'package.json', type: 'blob', size: 30 }, { path: 'src', type: 'tree' }, { path: 'src/index.ts', type: 'blob', size: 40 }, { path: 'pnpm-lock.yaml', type: 'blob', size: 9 }] };

  it('reads the tree and the selected files from GitHub hosts only', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url.startsWith('https://api.github.com/repos/acme/app/git/trees/main?recursive=1')) return Response.json(tree);
      if (url.endsWith('/package.json')) return new Response('{"scripts":{}}');
      if (url.endsWith('/src/index.ts')) return new Response('process.env.API_KEY');
      return new Response('', { status: 404 });
    };
    const r = await fetchRepoSnapshot({ owner: 'acme', repo: 'app', ref: 'main', readmePath: 'README.md' }, { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.tree).toEqual(['package.json', 'src/index.ts', 'pnpm-lock.yaml']);
    expect(Object.keys(r.snapshot.files)).toEqual(['package.json', 'src/index.ts']);
    expect(calls.every((u) => u.startsWith('https://api.github.com/') || u.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
  });

  it('rejects invalid targets without any request', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return new Response('');
    };
    for (const t of [{ owner: '-x', repo: 'a', ref: 'main' }, { owner: 'a', repo: '..', ref: 'main' }, { owner: 'a', repo: 'b', ref: '../x' }, { owner: 'a', repo: 'b', ref: 'main', readmePath: '../../etc' }]) {
      const r = await fetchRepoSnapshot({ readmePath: 'README.md', ...t }, { fetchImpl });
      expect(r.ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('maps 404 and rate limits', async () => {
    const notFound = await fetchRepoSnapshot({ owner: 'a', repo: 'b', ref: 'main', readmePath: 'README.md' }, { fetchImpl: async () => new Response('', { status: 404 }) });
    expect(!notFound.ok && notFound.error.code).toBe('NOT_FOUND');
    const limited = await fetchRepoSnapshot({ owner: 'a', repo: 'b', ref: 'main', readmePath: 'README.md' }, { fetchImpl: async () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) });
    expect(!limited.ok && limited.error.code).toBe('RATE_LIMITED');
  });

  it('records skipped files and keeps the truncated flag', async () => {
    const fetchImpl: FetchLike = async (url) => (url.includes('/git/trees/') ? Response.json({ ...tree, truncated: true }) : url.endsWith('package.json') ? new Response('', { status: 500 }) : new Response('x'));
    const r = await fetchRepoSnapshot({ owner: 'acme', repo: 'app', ref: 'main', readmePath: 'README.md' }, { fetchImpl });
    expect(r.ok && r.snapshot.truncated).toBe(true);
    expect(r.ok && r.skipped).toEqual(['package.json']);
  });
});

describe('checkRepository: monorepo workspaces', () => {
  const readme = md('# Mono', '', '## Tech Stack', '', '- Next.js', '- React', '', '## Usage', '', fence('bash', 'pnpm install', 'pnpm dev'));
  const files = {
    'package.json': JSON.stringify({ name: 'mono', private: true, scripts: { dev: 'pnpm --filter web dev' } }),
    'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'next dev', lint: 'next lint' }, dependencies: { next: '14', react: '18' } }),
    'packages/core/package.json': JSON.stringify({ name: 'core', dependencies: { zod: '3' } }),
    'examples/demo/package.json': JSON.stringify({ name: 'demo', dependencies: { vue: '3' } }),
  };

  it('dependencies of workspace packages verify README tech', () => {
    const r = run(readme, snapshot(files, ['pnpm-lock.yaml']));
    expect(status(r, 'tech:Next.js')).toBe('verified');
    expect(status(r, 'tech:React')).toBe('verified');
    expect(r.facts.workspaceManifests.map((m) => m.value)).toContain('apps/web/package.json');
  });

  it('selection reads workspace manifests but skips examples, tests and node_modules', () => {
    const entries = [...Object.keys(files), 'node_modules/x/package.json', 'packages/core/tests/fixtures/package.json'].map((path) => ({ path, size: 100 }));
    const picked = selectRepoFiles(entries, '');
    expect(picked.filter((p) => p.endsWith('package.json'))).toEqual(['package.json', 'apps/web/package.json', 'packages/core/package.json']);
  });

  it('workspace scripts never satisfy a root command', () => {
    const r = run(md('# Mono', '', fence('bash', 'pnpm install', 'npm run lint')), snapshot(files, ['pnpm-lock.yaml']));
    expect(status(r, 'script:lint')).toBe('contradiction');
  });

  it('a repo whose only package.json is nested does not report root scripts as missing', () => {
    const only = { 'apps/web/package.json': files['apps/web/package.json'] };
    const r = run(md('# Web', '', fence('bash', 'npm run dev')), snapshot(only));
    expect(status(r, 'script:dev')).not.toBe('contradiction');
  });
});
