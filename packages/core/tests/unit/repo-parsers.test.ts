import { describe, it, expect } from 'vitest';
import {
  minVersion,
  parsePackageJson,
  parseRequirements,
  parsePyproject,
  parseGoMod,
  parseCargoToml,
  parseRuntimeFile,
  parseDockerfile,
  runtimeFromImage,
  parseCompose,
  parseWorkflow,
  parseEnvExample,
  scanEnvUsage,
  parseMakefile,
  normalizePyName,
  isPlaceholderTestScript,
  lineOfMatch,
} from '../../src/repo/parsers';
import { selectRepoFiles, sourceScore, MAX_FILES } from '../../src/repo/select';
import { md } from '../helpers';

describe('minVersion', () => {
  it.each([
    ['>=20.9', 20, 9],
    ['^18', 18, null],
    ['~3.10', 3, 10],
    ['20.x', 20, null],
    ['v20.11.0', 20, 11],
    ['>=3.10,<4', 3, 10],
    ['18 || 20', 18, null],
    ['>= 16.0.0', 16, 0],
    ['3.11', 3, 11],
  ])('%s -> %s.%s', (spec, major, minor) => {
    expect(minVersion(spec)).toEqual({ minMajor: major, minMinor: minor });
  });

  it('returns null for specs without a lower bound', () => {
    expect(minVersion('lts/*')).toEqual({ minMajor: null, minMinor: null });
    expect(minVersion('<20')).toEqual({ minMajor: null, minMinor: null });
    expect(minVersion('')).toEqual({ minMajor: null, minMinor: null });
  });
});

describe('parsePackageJson', () => {
  const pkg = md('{', '  "name": "app",', '  "packageManager": "pnpm@9.1.0",', '  "engines": { "node": ">=20" },', '  "scripts": {', '    "dev": "next dev",', '    "test": "vitest run"', '  },', '  "dependencies": { "next": "14.2.0" },', '  "devDependencies": {', '    "vitest": "^2.0.0"', '  }', '}');

  it('reads scripts, dependencies, engines and packageManager with line numbers', () => {
    const p = parsePackageJson(pkg)!;
    expect(p.name).toBe('app');
    expect(p.scripts.map((s) => [s.value.name, s.value.command, s.line])).toEqual([
      ['dev', 'next dev', 6],
      ['test', 'vitest run', 7],
    ]);
    expect(p.scriptsSection).toMatchObject({ line: 5, snippet: expect.stringContaining('"dev": "next dev"') });
    expect(p.dependencies.map((d) => [d.value.name, d.value.dev, d.line])).toEqual([
      ['next', false, 9],
      ['vitest', true, 11],
    ]);
    expect(p.engines[0]).toMatchObject({ value: { runtime: 'node', spec: '>=20' }, line: 4 });
    expect(p.packageManager).toMatchObject({ value: 'pnpm@9.1.0', line: 3 });
  });

  it('returns null for invalid JSON', () => {
    expect(parsePackageJson('{ nope')).toBeNull();
    expect(parsePackageJson('42')).toBeNull();
  });

  it('detects the npm placeholder test script', () => {
    expect(isPlaceholderTestScript('echo "Error: no test specified" && exit 1')).toBe(true);
    expect(isPlaceholderTestScript('jest')).toBe(false);
  });
});

describe('Python manifests', () => {
  it('parseRequirements handles comments, extras, markers, -r lines and VCS eggs', () => {
    const r = parseRequirements(md('# deps', 'Django==5.0', 'uvicorn[standard]>=0.29  # server', '-r base.txt', 'git+https://github.com/x/y.git#egg=my_pkg', 'requests ; python_version>"3.8"', ''));
    expect(r.map((d) => [d.value.name, d.line])).toEqual([
      ['django', 2],
      ['uvicorn', 3],
      ['my-pkg', 5],
      ['requests', 6],
    ]);
  });

  it('parsePyproject reads PEP 621 (multi-line arrays), optional deps and requires-python', () => {
    const p = parsePyproject(md('[project]', 'name = "x"', 'requires-python = ">=3.10"', 'dependencies = [', '  "fastapi>=0.110",', '  "SQLAlchemy[asyncio]",', ']', '', '[project.optional-dependencies]', 'dev = ["pytest", "ruff"]', '', '[tool.uv]', 'dev-dependencies = []'));
    expect(p.requiresPython).toMatchObject({ value: '>=3.10', line: 3 });
    expect(p.dependencies.map((d) => [d.value.name, d.value.dev])).toEqual([
      ['fastapi', false],
      ['sqlalchemy', false],
      ['pytest', true],
      ['ruff', true],
    ]);
    expect(p.usesUv?.line).toBe(12);
    expect(p.usesPoetry).toBeNull();
  });

  it('parsePyproject reads Poetry dependency tables', () => {
    const p = parsePyproject(md('[tool.poetry]', 'name = "x"', '', '[tool.poetry.dependencies]', 'python = "^3.11"', 'Flask = "^3.0"', '', '[tool.poetry.group.dev.dependencies]', 'pytest = "^8"'));
    expect(p.usesPoetry?.line).toBe(1);
    expect(p.requiresPython?.value).toBe('^3.11');
    expect(p.dependencies.map((d) => [d.value.name, d.value.dev])).toEqual([
      ['flask', false],
      ['pytest', true],
    ]);
  });

  it('normalizePyName follows PEP 503', () => {
    expect(normalizePyName('Scikit_Learn')).toBe('scikit-learn');
    expect(normalizePyName('zope.interface')).toBe('zope-interface');
  });
});

describe('Go, Rust and runtime files', () => {
  it('parseGoMod', () => {
    const g = parseGoMod(md('module x', '', 'go 1.22', '', 'require (', '\tgithub.com/gin-gonic/gin v1.9.1', '\tgithub.com/lib/pq v1.10.9 // indirect', ')', 'require github.com/x/y v0.1.0'));
    expect(g.goVersion).toMatchObject({ value: '1.22', line: 3 });
    expect(g.dependencies.map((d) => d.value)).toEqual(['github.com/gin-gonic/gin', 'github.com/lib/pq', 'github.com/x/y']);
  });

  it('parseCargoToml', () => {
    const c = parseCargoToml(md('[package]', 'name = "x"', 'rust-version = "1.75"', '', '[dependencies]', 'tokio = { version = "1" }', 'serde = "1"', '', '[dev-dependencies]', 'insta = "1"'));
    expect(c.rustVersion?.value).toBe('1.75');
    expect(c.dependencies.map((d) => [d.value.name, d.value.dev])).toEqual([
      ['tokio', false],
      ['serde', false],
      ['insta', true],
    ]);
  });

  it('parseRuntimeFile', () => {
    expect(parseRuntimeFile('.nvmrc', 'v20.11.0\n')[0]!.value).toEqual({ runtime: 'node', spec: 'v20.11.0' });
    expect(parseRuntimeFile('a/.python-version', '3.11.4')[0]!.value).toEqual({ runtime: 'python', spec: '3.11.4' });
    expect(parseRuntimeFile('runtime.txt', 'python-3.12.1')[0]!.value).toEqual({ runtime: 'python', spec: '3.12.1' });
    expect(parseRuntimeFile('.tool-versions', 'nodejs 20.1.0\npython 3.11.2').map((r) => r.value.runtime)).toEqual(['node', 'python']);
    expect(parseRuntimeFile('rust-toolchain.toml', '[toolchain]\nchannel = "1.78"')[0]!.value).toEqual({ runtime: 'rust', spec: '1.78' });
    expect(parseRuntimeFile('.nvmrc', '\n# only comments\n')).toEqual([]);
  });
});

describe('Docker and Compose', () => {
  it('parseDockerfile reads FROM (multi-stage) and EXPOSE', () => {
    const d = parseDockerfile(md('FROM node:20-alpine AS deps', 'FROM --platform=linux/amd64 python:3.11-slim', 'FROM $BASE', 'EXPOSE 3000 8080/tcp'));
    expect(d.baseImages.map((b) => [b.value, b.line])).toEqual([
      ['node:20-alpine', 1],
      ['python:3.11-slim', 2],
    ]);
    expect(d.exposed.map((e) => e.value)).toEqual([3000, 8080]);
  });

  it('runtimeFromImage', () => {
    expect(runtimeFromImage('node:20-alpine')).toEqual({ runtime: 'node', spec: '20' });
    expect(runtimeFromImage('python:3.11-slim')).toEqual({ runtime: 'python', spec: '3.11' });
    expect(runtimeFromImage('golang:1.22')).toEqual({ runtime: 'go', spec: '1.22' });
    expect(runtimeFromImage('nginx:alpine')).toBeNull();
  });

  it('parseCompose reads services and images', () => {
    const c = parseCompose(md('version: "3.8"', 'services:', '  db:', '    image: postgres:16', '    ports:', '      - "5432:5432"', '  cache:', '    image: "redis:7-alpine"', '  web:', '    build: .', 'volumes:', '  data:'));
    expect(c.map((s) => [s.value.name, s.value.image, s.line])).toEqual([
      ['db', 'postgres:16', 3],
      ['cache', 'redis:7-alpine', 7],
      ['web', null, 9],
    ]);
    expect(parseCompose('version: 3')).toEqual([]);
  });
});

describe('parseWorkflow', () => {
  const wf = md(
    'jobs:',
    '  test:',
    '    strategy:',
    '      matrix:',
    '        node-version: [18, 20, 22]',
    '    steps:',
    '      - uses: pnpm/action-setup@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: ${{ matrix.node-version }}',
    '          cache: pnpm',
    '      - run: pnpm install --frozen-lockfile',
    '      - name: Test',
    '        run: |',
    '          pnpm lint',
    '          pnpm test',
    '      - uses: actions/setup-python@v5',
    '        with:',
    "          python-version: '3.11'"
  );

  it('reads single-line and block run commands with lines', () => {
    expect(parseWorkflow(wf).commands.map((c) => [c.value, c.line])).toEqual([
      ['pnpm install --frozen-lockfile', 12],
      ['pnpm lint', 15],
      ['pnpm test', 16],
    ]);
  });

  it('reads runtime versions (matrix minimum) and ignores expressions', () => {
    expect(parseWorkflow(wf).runtimes.map((r) => [r.value.runtime, r.value.spec])).toEqual([
      ['node', '18'],
      ['python', '3.11'],
    ]);
  });

  it('reads package managers set up in CI', () => {
    expect(parseWorkflow(wf).managers.map((m) => m.value)).toEqual(['pnpm', 'pnpm']);
  });
});

describe('env files and env usage in code', () => {
  it('parseEnvExample reads assignments, export lines and commented-out variables', () => {
    const e = parseEnvExample(md('# Database', 'DATABASE_URL=postgres://localhost/db', 'export API_KEY=', '# OPTIONAL_FLAG=true', '# This is a comment = not a var', 'DATABASE_URL=dup'));
    expect(e.map((x) => [x.value, x.line])).toEqual([
      ['DATABASE_URL', 2],
      ['API_KEY', 3],
      ['OPTIONAL_FLAG', 4],
    ]);
  });

  it('scanEnvUsage finds variables across languages and skips platform variables', () => {
    const js = md('const url = process.env.DATABASE_URL;', "const k = process.env['STRIPE_KEY'];", 'const { REDIS_URL, PORT: port } = process.env;', 'if (process.env.NODE_ENV === "production") {}', 'const v = import.meta.env.VITE_API_URL;');
    expect(scanEnvUsage(js).map((e) => [e.value, e.line])).toEqual([
      ['DATABASE_URL', 1],
      ['STRIPE_KEY', 2],
      ['REDIS_URL', 3],
      ['PORT', 3],
      ['VITE_API_URL', 5],
    ]);
    expect(scanEnvUsage(md('import os', 'a = os.environ["SECRET_KEY"]', 'b = os.getenv("OPENAI_API_KEY", "")', 'c = os.environ.get("DEBUG")')).map((e) => e.value)).toEqual(['SECRET_KEY', 'OPENAI_API_KEY', 'DEBUG']);
    expect(scanEnvUsage('x := os.Getenv("GO_PORT")').map((e) => e.value)).toEqual(['GO_PORT']);
    expect(scanEnvUsage('let k = std::env::var("RUST_KEY")?;').map((e) => e.value)).toEqual(['RUST_KEY']);
    expect(scanEnvUsage('key = ENV.fetch("RAILS_KEY")').map((e) => e.value)).toEqual(['RAILS_KEY']);
    expect(scanEnvUsage('String s = System.getenv("JAVA_KEY");').map((e) => e.value)).toEqual(['JAVA_KEY']);
    expect(scanEnvUsage("$k = getenv('PHP_KEY');").map((e) => e.value)).toEqual(['PHP_KEY']);
    expect(scanEnvUsage('process.env.lowercase')).toEqual([]);
  });

  it('parseMakefile reads targets and skips variable assignments', () => {
    expect(parseMakefile(md('VERSION := 1.0', '.PHONY: test', 'build:', '\tgo build', 'test: build', '\tgo test ./...')).map((t) => t.value)).toEqual(['build', 'test']);
  });

  it('lineOfMatch', () => {
    expect(lineOfMatch('a\nb\nc', /c/)).toBe(3);
    expect(lineOfMatch('a\nb', /z/)).toBe(0);
  });
});

describe('selectRepoFiles', () => {
  const tree = [
    'package.json',
    'pnpm-lock.yaml',
    'apps/web/package.json',
    'apps/web/README.md',
    'apps/web/.env.example',
    '.github/workflows/ci.yml',
    'Dockerfile',
    'LICENSE',
    'src/config/env.ts',
    'src/index.ts',
    'src/components/Button.tsx',
    'node_modules/x/index.js',
    'tests/env.test.ts',
    'dist/server.js',
    'src/types.d.ts',
  ].map((path) => ({ path, size: 100 }));

  it('reads manifests in the README directory first, then the root, then env, workflows, license and sources', () => {
    const picked = selectRepoFiles(tree, 'apps/web');
    expect(picked.slice(0, 3)).toEqual(['apps/web/package.json', 'package.json', 'Dockerfile']);
    expect(picked).toContain('apps/web/.env.example');
    expect(picked).toContain('.github/workflows/ci.yml');
    expect(picked).toContain('LICENSE');
    expect(picked).toContain('src/config/env.ts');
  });

  it('skips vendored, built, test and declaration files, and files over the size limit', () => {
    const picked = selectRepoFiles([...tree, { path: 'src/huge-config.ts', size: 5_000_000 }], '');
    for (const p of ['node_modules/x/index.js', 'tests/env.test.ts', 'dist/server.js', 'src/types.d.ts', 'src/huge-config.ts', 'pnpm-lock.yaml']) expect(picked).not.toContain(p);
  });

  it('caps the number of files', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ path: `src/mod${i}.ts`, size: 10 }));
    expect(selectRepoFiles(many, '').length).toBeLessThanOrEqual(MAX_FILES);
  });

  it('ranks config and entry files higher', () => {
    expect(sourceScore('src/config.ts')).toBeGreaterThan(sourceScore('src/components/deep/Button.tsx'));
    expect(sourceScore('server.js')).toBeGreaterThan(sourceScore('utils.js'));
  });
});
