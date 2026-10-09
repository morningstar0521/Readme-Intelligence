/**
 * Choose which repository files to read. Pure function over the tree listing, so it is
 * fully testable and the number of network reads stays small and predictable
 * (at most MAX_FILES files).
 */

export const MAX_FILES = 60;
export const MAX_SOURCE_FILES = 30;
export const MAX_FILE_BYTES = 200_000;
export const MAX_WORKSPACE_MANIFESTS = 8;

export interface TreeEntry {
  path: string;
  size?: number;
}

const MANIFESTS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'requirements_dev.txt',
  'dev-requirements.txt',
  'Pipfile',
  'environment.yml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
];

const RUNTIME_FILES = ['.nvmrc', '.node-version', '.python-version', 'runtime.txt', '.tool-versions', 'rust-toolchain', 'rust-toolchain.toml'];

const DOCKER_FILES = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

const ENV_EXAMPLE_RE = /(^|\/)(\.env(\.[\w-]+)?\.(example|sample|template|dist)|example\.env|env\.example|\.env\.local\.example)$/i;
const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const LICENSE_RE = /^(LICEN[CS]E|COPYING)(\.(md|txt|rst))?$/i;
const CONTRIBUTING_RE = /^(\.github\/|docs\/)?CONTRIBUTING(\.(md|rst|txt))?$/i;

const SOURCE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rb|rs|php|java|kt|cs)$/i;
const EXCLUDED_DIR_RE = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage|__pycache__|\.venv|venv|site-packages|third_party|fixtures|__snapshots__|docs|examples?|samples?|tests?|__tests__|spec|e2e|benchmarks?)(\/|$)/i;

export const LOCKFILES: Record<string, string> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'poetry.lock': 'poetry',
  'uv.lock': 'uv',
  'Pipfile.lock': 'pipenv',
  'Cargo.lock': 'cargo',
  'go.sum': 'go',
  'Gemfile.lock': 'bundler',
  'composer.lock': 'composer',
};

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function depth(path: string): number {
  return path.split('/').length - 1;
}

/** Score source files so config / entry files are read first. */
export function sourceScore(path: string): number {
  const name = path.split('/').pop()!.toLowerCase();
  let score = 0;
  if (/(config|env|settings|constants|secrets|credentials)/.test(name)) score += 4;
  if (/^(index|main|app|server|manage|wsgi|asgi|cli|bootstrap|start)\./.test(name)) score += 2;
  if (/(^|\/)(src|app|lib|server|api|backend|config)\//i.test(path)) score += 1;
  score -= Math.max(0, depth(path) - 2) * 0.5;
  return score;
}

/** Paths to read, in priority order. */
export function selectRepoFiles(entries: TreeEntry[], baseDir: string): string[] {
  const paths = new Set(entries.map((e) => e.path));
  const sizes = new Map(entries.map((e) => [e.path, e.size ?? 0]));
  const out: string[] = [];
  const add = (p: string) => {
    if (paths.has(p) && !out.includes(p) && (sizes.get(p) ?? 0) <= MAX_FILE_BYTES) out.push(p);
  };

  const dirs = baseDir ? [baseDir, ''] : [''];
  for (const dir of dirs) {
    for (const name of [...MANIFESTS, ...RUNTIME_FILES, ...DOCKER_FILES, 'Makefile']) add(join(dir, name));
  }

  // Monorepo packages (apps/web/package.json...): read for dependencies, so "Next.js" in the README is not "README only".
  const nested = [...paths]
    .filter((p) => /(^|\/)package\.json$/.test(p) && depth(p) >= 1 && depth(p) <= 3 && !EXCLUDED_DIR_RE.test(p))
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, MAX_WORKSPACE_MANIFESTS);
  for (const p of nested) add(p);

  for (const p of [...paths].filter((p) => ENV_EXAMPLE_RE.test(p) && depth(p) <= 3).sort((a, b) => depth(a) - depth(b)).slice(0, 5)) add(p);
  for (const p of [...paths].filter((p) => WORKFLOW_RE.test(p)).sort().slice(0, 8)) add(p);
  for (const p of [...paths].filter((p) => LICENSE_RE.test(p))) add(p);

  const sources = [...paths]
    .filter((p) => SOURCE_EXT_RE.test(p) && !EXCLUDED_DIR_RE.test(p) && !/\.(d\.ts|min\.js|test\.\w+|spec\.\w+)$/i.test(p) && depth(p) <= 5)
    .filter((p) => !baseDir || p.startsWith(`${baseDir}/`) || depth(p) <= 2)
    .sort((a, b) => sourceScore(b) - sourceScore(a) || a.localeCompare(b))
    .slice(0, MAX_SOURCE_FILES);
  for (const p of sources) add(p);

  return out.slice(0, MAX_FILES);
}

export function isLicensePath(path: string): boolean {
  return LICENSE_RE.test(path);
}

export function isContributingPath(path: string): boolean {
  return CONTRIBUTING_RE.test(path);
}

export function isEnvExamplePath(path: string): boolean {
  return ENV_EXAMPLE_RE.test(path);
}

export function isWorkflowPath(path: string): boolean {
  return WORKFLOW_RE.test(path);
}

export function isSourcePath(path: string): boolean {
  return SOURCE_EXT_RE.test(path);
}
