import type { Root as HastRoot, Element } from 'hast';
import type { CommandItem, Intelligence, SourceRef } from '../types';
import type { Claim, ClaimStatus, PackageManager, RealityReport, RepoEvidence, RepoFacts, RepoSnapshot } from './types';
import { extractRepoFacts, evidenceOf } from './facts';
import { minVersion, normalizePyName } from './parsers';
import { categorizeCommand } from '../extract/commands';
import { computeReadiness } from './readiness';

/**
 * Repository Reality Check: compare what the README says with what the repository contains.
 *
 * Precision rule: a claim is a CONTRADICTION only when both sides are explicit (a README command
 * names a script that package.json does not define, a README link points at a file that is not in
 * the tree, ...). When the repository simply lacks evidence, the claim is README-only or unverified.
 * "File missing" checks are skipped when GitHub truncated the tree.
 */

export interface RealityInput {
  intelligence: Intelligence;
  hast?: HastRoot;
}

class ClaimSet {
  readonly claims = new Map<string, Claim>();
  add(claim: Claim): void {
    const existing = this.claims.get(claim.id);
    if (!existing) {
      this.claims.set(claim.id, claim);
      return;
    }
    // Same claim seen twice: keep the stronger status and merge evidence.
    const rank: Record<ClaimStatus, number> = { contradiction: 4, verified: 3, 'repo-only': 2, 'readme-only': 1, unverified: 0 };
    if (rank[claim.status] > rank[existing.status]) {
      existing.status = claim.status;
      existing.title = claim.title;
      existing.detail = claim.detail;
    }
    for (const r of claim.readme) if (!existing.readme.some((x) => x.line === r.line)) existing.readme.push(r);
    for (const r of claim.repo) if (!existing.repo.some((x) => x.path === r.path && (x.kind === 'tree-absence' && r.kind === 'tree-absence' || x.kind === 'content' && r.kind === 'content' && x.line === r.line))) existing.repo.push(r);
  }
}

const basename = (p: string) => p.split('/').pop()!;

// ------------------------------------------------------------------ tree helpers

function treeHasFile(s: RepoSnapshot, path: string): string | null {
  const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean) return null;
  for (const candidate of [s.baseDir ? `${s.baseDir}/${clean}` : clean, clean]) {
    if (s.tree.includes(candidate)) return candidate;
  }
  return null;
}

function treeHasDir(s: RepoSnapshot, path: string): string | null {
  const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean) return null;
  for (const candidate of [s.baseDir ? `${s.baseDir}/${clean}` : clean, clean]) {
    if (s.tree.some((p) => p.startsWith(`${candidate}/`))) return candidate;
  }
  return null;
}

/** File anywhere in the tree with this relative tail (used after an unknown `cd`). */
function treeHasTail(s: RepoSnapshot, path: string): string | null {
  const clean = path.replace(/^\.\//, '');
  return s.tree.find((p) => p === clean || p.endsWith(`/${clean}`)) ?? null;
}

// ------------------------------------------------------------------ scripts

const PM_BUILTINS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'up', 'update', 'upgrade', 'ci', 'exec', 'dlx', 'create', 'init',
  'x', 'link', 'unlink', 'publish', 'pack', 'audit', 'outdated', 'why', 'list', 'ls', 'global', 'config', 'set', 'info',
  'login', 'logout', 'store', 'import', 'patch', 'rebuild', 'prune', 'dedupe', 'env', 'setup', 'version', 'workspaces',
  'workspace', 'help', 'cache', 'bin', 'root', 'fund', 'doctor', 'npx', 'node', 'stop', 'restart', 'licenses', 'upgrade-interactive',
]);

interface ScriptRef {
  script: string;
  manager: string;
  workspaceScoped: boolean;
  /** "pnpm dev" style (no "run"): pnpm, yarn and bun fall back to a package binary with that name. */
  shorthand: boolean;
}

/** Script names that are almost always scripts, never package binaries. */
const COMMON_SCRIPTS = new Set(['dev', 'start', 'build', 'test', 'lint', 'format', 'typecheck', 'type-check', 'preview', 'serve', 'deploy', 'seed', 'migrate', 'e2e', 'clean', 'check', 'watch', 'storybook', 'docs', 'release', 'setup', 'bootstrap']);

/** Script a package-manager command runs, e.g. "pnpm dev" -> dev, "npm run build:prod" -> build:prod. */
export function scriptReference(command: string): ScriptRef | null {
  const tokens = command.replace(/^sudo\s+/, '').split(/\s+/).filter(Boolean);
  const manager = tokens[0];
  if (!manager || !['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) return null;
  const workspaceScoped = tokens.some((t) => /^(--filter|-F|-r|--recursive|-w|--workspace|--workspaces|-C|--prefix|--dir)$/.test(t) || t.startsWith('--filter=')) || tokens[1] === 'workspace';
  const rest = tokens.slice(1).filter((t, i, arr) => !t.startsWith('-') && !(i > 0 && /^(--filter|-F|-C|--prefix|--dir|-w|--workspace)$/.test(arr[i - 1]!)));
  if (tokens[1] === 'workspace') return rest[2] ? { script: rest[2], manager, workspaceScoped: true, shorthand: false } : null;
  const first = rest[0];
  if (!first) return null;
  if (first === 'run' || first === 'run-script') return rest[1] ? { script: rest[1], manager, workspaceScoped, shorthand: false } : null;
  if (first === 'test' || first === 't' || first === 'tst') return { script: 'test', manager, workspaceScoped, shorthand: false };
  if (first === 'start') return { script: 'start', manager, workspaceScoped, shorthand: false };
  if (manager === 'npm') return null; // npm needs "run" for custom scripts
  if (PM_BUILTINS.has(first)) return null;
  if (manager === 'bun' && /\.(ts|js|tsx|jsx|mjs)$/.test(first)) return null; // bun file.ts
  return { script: first, manager, workspaceScoped, shorthand: true };
}

function checkScripts(set: ClaimSet, s: RepoSnapshot, f: RepoFacts, commands: CommandItem[]): void {
  const hasPackageJson = f.manifests.some((m) => basename(m.value) === 'package.json');
  for (const c of commands) {
    const ref = scriptReference(c.command);
    if (ref) {
      const found = f.scripts.find((sc) => sc.value.name === ref.script);
      const id = `script:${ref.script}`;
      if (found) {
        set.add({ id, category: 'command', status: 'verified', title: `\`${c.command}\` runs an existing script`, detail: `package.json defines "${ref.script}": ${found.value.command}`, readme: [c.source], repo: [found.evidence] });
      } else if (ref.shorthand && !COMMON_SCRIPTS.has(ref.script)) {
        const dep = f.dependencies.find((d) => d.value.ecosystem === 'node' && (d.value.name === ref.script || d.value.name.endsWith(`/${ref.script}`)));
        set.add(
          dep
            ? { id, category: 'command', status: 'verified', title: `\`${c.command}\` runs the ${ref.script} package binary`, detail: `No "${ref.script}" script, but ${ref.manager} runs the binary from the "${dep.value.name}" dependency.`, readme: [c.source], repo: [dep.evidence] }
            : { id, category: 'command', status: 'unverified', title: `\`${c.command}\` could not be checked`, detail: `No "${ref.script}" script. ${ref.manager} may run a package binary with that name.`, readme: [c.source], repo: [] }
        );
      } else if (hasPackageJson && !ref.workspaceScoped) {
        const pkg = f.manifests.find((m) => basename(m.value) === 'package.json')!;
        const evidence = f.scriptSections.find((section) => section.value === pkg.value)?.evidence ?? pkg.evidence;
        const status = ref.script === 'start' ? 'unverified' : 'contradiction';
        set.add({ id, category: 'command', status, title: `\`${c.command}\` runs a script that was not found`, detail: `No "${ref.script}" script was found in ${pkg.value}. Available: ${f.scripts.map((x) => x.value.name).join(', ') || 'none'}.`, readme: [c.source], repo: [evidence] });
      } else {
        set.add({ id, category: 'command', status: 'unverified', title: `\`${c.command}\` could not be checked`, detail: ref.workspaceScoped ? 'The command targets a workspace package that was not inspected.' : 'No package.json found next to the README or at the repository root.', readme: [c.source], repo: [] });
      }
      continue;
    }
    const make = /^make\s+([A-Za-z0-9][\w.-]*)/.exec(c.command);
    if (make) {
      const target = make[1]!;
      const found = f.makeTargets.find((t) => t.value === target);
      const makefile = treeHasFile(s, 'Makefile');
      const id = `make:${target}`;
      if (found) set.add({ id, category: 'command', status: 'verified', title: `\`make ${target}\` target exists`, detail: 'Defined in the Makefile.', readme: [c.source], repo: [found.evidence] });
      else if (makefile) set.add({ id, category: 'command', status: 'contradiction', title: `\`make ${target}\` target not found`, detail: `The Makefile has no "${target}" target.`, readme: [c.source], repo: [evidenceOf(s, makefile)] });
      else if (!s.truncated) set.add({ id, category: 'command', status: 'contradiction', title: `\`make ${target}\` but there is no Makefile`, detail: 'No Makefile next to the README or at the repository root.', readme: [c.source], repo: [] });
    }
  }
}

// ------------------------------------------------------------------ package manager

const NODE_PMS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

function readmeNodeManagers(commands: CommandItem[]): Map<string, SourceRef> {
  const out = new Map<string, SourceRef>();
  for (const c of commands) {
    const t = c.command.replace(/^sudo\s+/, '').split(/\s+/);
    const pm = t[0]!;
    if (!(NODE_PMS as readonly string[]).includes(pm)) continue;
    // Global tool installs ("npm i -g vercel") say nothing about the project's manager.
    if (t.includes('-g') || t.includes('--global') || t[1] === 'create' || t[1] === 'dlx' || t[1] === 'exec' || t[1] === 'x') continue;
    if (!out.has(pm)) out.set(pm, c.source);
  }
  return out;
}

function checkPackageManager(set: ClaimSet, f: RepoFacts, commands: CommandItem[]): void {
  const readme = readmeNodeManagers(commands);
  const repo = f.packageManagers.filter((p) => (NODE_PMS as readonly string[]).includes(p.value));
  const ci = new Map<string, RepoEvidence>();
  for (const c of f.ciCommands) {
    const pm = c.value.split(/\s+/)[0]!;
    if ((NODE_PMS as readonly string[]).includes(pm) && !ci.has(pm)) ci.set(pm, c.evidence);
  }
  if (readme.size === 0) return;
  const readmeList = [...readme.keys()];
  const readmeRefs = [...readme.values()];

  if (repo.length === 0) {
    if (f.ecosystems.includes('node')) {
      set.add({ id: 'pm:node', category: 'package-manager', status: 'unverified', title: `README uses ${readmeList.join(' / ')}, but the repository has no lockfile`, detail: 'No package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock was found, so the manager cannot be confirmed and installs are not reproducible.', readme: readmeRefs, repo: [] });
    }
    return;
  }
  if (repo.length > 1) {
    set.add({ id: 'pm:node', category: 'package-manager', status: 'unverified', title: 'Several Node lockfiles in the repository', detail: `Found lockfiles for ${repo.map((r) => r.value).join(', ')}. It is unclear which manager is intended.`, readme: readmeRefs, repo: repo.map((r) => r.evidence) });
    return;
  }
  const actual = repo[0]!;
  const evidence = [actual.evidence, ...(ci.has(actual.value) ? [ci.get(actual.value)!] : [])];
  if (readme.has(actual.value)) {
    set.add({ id: 'pm:node', category: 'package-manager', status: 'verified', title: `Package manager matches: ${actual.value}`, detail: `The README uses ${actual.value} and the repository has ${basename(actual.evidence.path)}.`, readme: [readme.get(actual.value)!], repo: evidence });
  } else {
    set.add({ id: 'pm:node', category: 'package-manager', status: 'contradiction', title: `README uses ${readmeList.join(' / ')}, repository uses ${actual.value}`, detail: `The repository is locked with ${basename(actual.evidence.path)}. Installing with ${readmeList[0]} ignores that lockfile and can install different versions.`, readme: readmeRefs, repo: evidence });
  }
}

function checkPythonManager(set: ClaimSet, f: RepoFacts, commands: CommandItem[]): void {
  const uses = (re: RegExp) => commands.find((c) => re.test(c.command));
  const poetry = uses(/^poetry\s+(install|add|run|shell|sync)\b/);
  const uv = uses(/^uv\s+(sync|pip|run|add|venv)\b/);
  const pipenv = uses(/^pipenv\s/);
  const has = (pm: PackageManager) => f.packageManagers.find((p) => p.value === pm);
  for (const [pm, cmd] of [['poetry', poetry], ['uv', uv], ['pipenv', pipenv]] as const) {
    if (!cmd) continue;
    const ev = has(pm);
    set.add(
      ev
        ? { id: `pm:${pm}`, category: 'package-manager', status: 'verified', title: `${pm} setup confirmed`, detail: `The repository is configured for ${pm}.`, readme: [cmd.source], repo: [ev.evidence] }
        : { id: `pm:${pm}`, category: 'package-manager', status: 'unverified', title: `README uses ${pm}, no ${pm} configuration found`, detail: `No ${pm} lockfile or configuration was found in the inspected files.`, readme: [cmd.source], repo: [] }
    );
  }
}

// ------------------------------------------------------------------ runtimes

const RUNTIME_PATTERNS: [RepoFacts['runtimes'][number]['value']['runtime'], RegExp][] = [
  ['node', /\bnode(?:\.?js)?\s*(?:v(?:ersion)?\s*)?(?:>=|≥|\^|~)?\s*v?(\d+(?:\.\d+)?)/i],
  ['python', /\bpython\s*(?:v(?:ersion)?\s*)?(?:>=|≥|\^|~)?\s*(\d+\.\d+|\d+)/i],
  ['go', /\b(?:go|golang)\s*(?:v(?:ersion)?\s*)?(?:>=|≥)?\s*(1\.\d+)/i],
  ['java', /\b(?:java|jdk|openjdk)\s*(?:v(?:ersion)?\s*)?(?:>=|≥)?\s*(\d+)/i],
  ['rust', /\brust(?:c)?\s*(?:>=|≥)?\s*(1\.\d+)/i],
];

const REQUIREMENT_FILES = /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/;
const PIN_FILES = /(^|\/)(\.nvmrc|\.node-version|\.python-version|runtime\.txt|\.tool-versions)$/;

function cmpVersion(a: { minMajor: number | null; minMinor: number | null }, b: { minMajor: number | null; minMinor: number | null }): number {
  if (a.minMajor === null || b.minMajor === null) return 0;
  if (a.minMajor !== b.minMajor) return a.minMajor - b.minMajor;
  if (a.minMinor === null || b.minMinor === null) return 0;
  return a.minMinor - b.minMinor;
}

function checkRuntimes(set: ClaimSet, f: RepoFacts, intel: Intelligence): void {
  const mentioned = new Map<string, { spec: string; v: { minMajor: number | null; minMinor: number | null }; source: SourceRef }>();
  for (const p of intel.prerequisites) {
    for (const [runtime, re] of RUNTIME_PATTERNS) {
      const m = re.exec(p.value);
      if (m && !mentioned.has(runtime)) mentioned.set(runtime, { spec: m[1]!, v: minVersion(m[1]!), source: p.source });
    }
  }

  const runtimes = new Set([...mentioned.keys(), ...f.runtimes.map((r) => r.value.runtime)]);
  for (const runtime of runtimes) {
    const readme = mentioned.get(runtime);
    const repo = f.runtimes.filter((r) => r.value.runtime === runtime);
    const ci = f.ciRuntimes.filter((r) => r.value.runtime === runtime);
    const label = runtime === 'node' ? 'Node.js' : runtime[0]!.toUpperCase() + runtime.slice(1);
    const id = `runtime:${runtime}`;

    if (readme && repo.length === 0) {
      set.add({ id, category: 'runtime', status: 'readme-only', title: `README requires ${label} ${readme.spec}, the repository does not pin a version`, detail: 'No engines field, version file, requires-python or Docker base image states the version.', readme: [readme.source], repo: ci.map((c) => c.evidence) });
      continue;
    }
    if (!readme) {
      const strongest = repo.find((r) => REQUIREMENT_FILES.test(r.evidence.path)) ?? repo[0]!;
      set.add({ id, category: 'runtime', status: 'repo-only', title: `Repository expects ${label} ${strongest.value.spec}, README does not say`, detail: `Add the required ${label} version to the Prerequisites section.`, readme: [], repo: repo.map((r) => r.evidence) });
      continue;
    }

    const conflicts: string[] = [];
    const conflictEvidence: RepoEvidence[] = [];
    for (const r of repo) {
      const rv = { minMajor: r.value.minMajor, minMinor: r.value.minMinor };
      if (REQUIREMENT_FILES.test(r.evidence.path) && cmpVersion(readme.v, rv) < 0) {
        conflicts.push(`${r.evidence.path} requires ${r.value.spec}`);
        conflictEvidence.push(r.evidence);
      }
      if (PIN_FILES.test(r.evidence.path) && cmpVersion(rv, readme.v) < 0) {
        conflicts.push(`${r.evidence.path} pins ${r.value.spec}`);
        conflictEvidence.push(r.evidence);
      }
    }
    if (conflicts.length > 0) {
      set.add({ id, category: 'runtime', status: 'contradiction', title: `README says ${label} ${readme.spec}, the repository disagrees`, detail: `${conflicts.join('; ')}.`, readme: [readme.source], repo: conflictEvidence });
    } else {
      set.add({ id, category: 'runtime', status: 'verified', title: `${label} ${readme.spec} is consistent with the repository`, detail: `Checked against ${repo.map((r) => `${r.evidence.path} (${r.value.spec})`).join(', ')}.`, readme: [readme.source], repo: [...repo.map((r) => r.evidence), ...ci.map((c) => c.evidence)] });
    }
  }
}

// ------------------------------------------------------------------ env vars

/** Without an example env file, a documented variable is only called README-only after scanning this many source files. */
export const MIN_SCANNED_FOR_README_ONLY = 10;

function checkEnv(set: ClaimSet, f: RepoFacts, intel: Intelligence): void {
  const documented = new Map(intel.envVars.map((e) => [e.name, e]));
  const example = new Map<string, RepoEvidence>();
  for (const e of f.envExample) if (!example.has(e.value)) example.set(e.value, e.evidence);
  const code = new Map<string, RepoEvidence>();
  for (const e of f.envInCode) if (!code.has(e.value)) code.set(e.value, e.evidence);

  for (const [name, env] of documented) {
    const ev = [example.get(name), code.get(name)].filter((x): x is RepoEvidence => Boolean(x));
    if (ev.length > 0) {
      const where = [example.has(name) ? 'the example env file' : null, code.has(name) ? 'source code' : null].filter(Boolean).join(' and ');
      set.add({ id: `env:${name}`, category: 'env', status: 'verified', title: `${name} is used by the repository`, detail: `Found in ${where}.`, readme: [env.source], repo: ev });
    } else if (f.envExample.length > 0 || f.scannedSourceFiles >= MIN_SCANNED_FOR_README_ONLY) {
      set.add({ id: `env:${name}`, category: 'env', status: 'readme-only', title: `${name} is documented but not found in the repository`, detail: `Not in ${f.envExample.length > 0 ? 'the example env file' : 'any example env file'} and not read in the ${f.scannedSourceFiles} source files scanned. It may be stale, or read by code that was not scanned.`, readme: [env.source], repo: [] });
    } else {
      set.add({ id: `env:${name}`, category: 'env', status: 'unverified', title: `${name} could not be checked`, detail: `No example env file, and only ${f.scannedSourceFiles} source file(s) were scanned: not enough evidence either way.`, readme: [env.source], repo: [] });
    }
  }

  const undocumented = new Map<string, RepoEvidence[]>();
  for (const [name, ev] of [...example, ...code]) {
    if (documented.has(name)) continue;
    undocumented.set(name, [...(undocumented.get(name) ?? []), ev]);
  }
  for (const [name, ev] of undocumented) {
    const where = [example.has(name) ? 'the example env file' : null, code.has(name) ? 'source code' : null].filter(Boolean).join(' and ');
    set.add({ id: `env:${name}`, category: 'env', status: 'repo-only', title: `${name} is used but not documented`, detail: `Found in ${where}, but the README does not mention it.`, readme: [], repo: ev });
  }
}

// ------------------------------------------------------------------ tech stack vs dependencies

interface TechSignal {
  node?: string[];
  python?: string[];
  rust?: string[];
  go?: string[];
  images?: RegExp;
  files?: RegExp;
  notable?: boolean;
}

/** Technology -> repository signals. Only technologies listed here are cross-checked. */
export const TECH_SIGNALS: Record<string, TechSignal> = {
  React: { node: ['react'], notable: true },
  'Next.js': { node: ['next'], notable: true },
  Vue: { node: ['vue'], notable: true },
  Nuxt: { node: ['nuxt'], notable: true },
  Angular: { node: ['@angular/core'], notable: true },
  Svelte: { node: ['svelte'], notable: true },
  SvelteKit: { node: ['@sveltejs/kit'], notable: true },
  Astro: { node: ['astro'], notable: true },
  Remix: { node: ['@remix-run/react', '@remix-run/node'], notable: true },
  'Tailwind CSS': { node: ['tailwindcss', '@tailwindcss/vite', '@tailwindcss/postcss'], notable: true },
  Vite: { node: ['vite'] },
  Redux: { node: ['redux', '@reduxjs/toolkit'] },
  Zustand: { node: ['zustand'] },
  'TanStack Query': { node: ['@tanstack/react-query', 'react-query'] },
  'Material UI': { node: ['@mui/material'] },
  'shadcn/ui': { files: /(^|\/)components\.json$/ },
  Electron: { node: ['electron'], notable: true },
  'React Native': { node: ['react-native'], notable: true },
  Expo: { node: ['expo'], notable: true },
  'Node.js': { files: /(^|\/)package\.json$/ },
  TypeScript: { node: ['typescript'], files: /(^|\/)tsconfig(\.[\w-]+)?\.json$/ },
  Express: { node: ['express'], notable: true },
  NestJS: { node: ['@nestjs/core'], notable: true },
  Fastify: { node: ['fastify'], notable: true },
  Koa: { node: ['koa'], notable: true },
  Hono: { node: ['hono'], notable: true },
  GraphQL: { node: ['graphql'], python: ['graphene', 'strawberry-graphql', 'ariadne'] },
  Apollo: { node: ['@apollo/server', '@apollo/client', 'apollo-server'] },
  tRPC: { node: ['@trpc/server'] },
  'Socket.IO': { node: ['socket.io'], python: ['python-socketio'] },
  FastAPI: { python: ['fastapi'], notable: true },
  Django: { python: ['django'], notable: true },
  Flask: { python: ['flask'], notable: true },
  Celery: { python: ['celery'] },
  Pydantic: { python: ['pydantic'] },
  Gunicorn: { python: ['gunicorn'] },
  PostgreSQL: { node: ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres'], python: ['psycopg2', 'psycopg2-binary', 'psycopg', 'asyncpg'], go: ['github.com/lib/pq', 'github.com/jackc/pgx/v5', 'github.com/jackc/pgx/v4'], rust: ['tokio-postgres', 'postgres'], images: /^(postgres|postgis\/postgis|bitnami\/postgresql)(:|$)/, notable: true },
  MySQL: { node: ['mysql', 'mysql2'], python: ['mysqlclient', 'pymysql', 'mysql-connector-python'], go: ['github.com/go-sql-driver/mysql'], images: /^(mysql|mariadb)(:|$)/, notable: true },
  SQLite: { node: ['sqlite3', 'better-sqlite3'], rust: ['rusqlite'] },
  MongoDB: { node: ['mongodb', 'mongoose'], python: ['pymongo', 'motor', 'mongoengine'], go: ['go.mongodb.org/mongo-driver'], images: /^mongo(:|$)/, notable: true },
  Redis: { node: ['redis', 'ioredis', '@upstash/redis'], python: ['redis'], go: ['github.com/redis/go-redis/v9', 'github.com/go-redis/redis/v8'], images: /^(redis|valkey\/valkey)(:|$)/, notable: true },
  Elasticsearch: { node: ['@elastic/elasticsearch'], python: ['elasticsearch'], images: /elasticsearch/ },
  Supabase: { node: ['@supabase/supabase-js'], python: ['supabase'], notable: true },
  Prisma: { node: ['prisma', '@prisma/client'], notable: true },
  'Drizzle ORM': { node: ['drizzle-orm'], notable: true },
  TypeORM: { node: ['typeorm'] },
  Sequelize: { node: ['sequelize'] },
  Mongoose: { node: ['mongoose'] },
  SQLAlchemy: { python: ['sqlalchemy'] },
  'NextAuth.js': { node: ['next-auth'], notable: true },
  'Auth.js': { node: ['@auth/core', 'next-auth'] },
  Clerk: { node: ['@clerk/nextjs', '@clerk/clerk-react', '@clerk/clerk-sdk-node'], notable: true },
  Auth0: { node: ['@auth0/nextjs-auth0', '@auth0/auth0-react', 'auth0'] },
  'Passport.js': { node: ['passport'] },
  JWT: { node: ['jsonwebtoken', 'jose'], python: ['pyjwt', 'python-jose'] },
  bcrypt: { node: ['bcrypt', 'bcryptjs'], python: ['bcrypt'] },
  OpenAI: { node: ['openai', '@ai-sdk/openai'], python: ['openai'], notable: true },
  'Anthropic Claude': { node: ['@anthropic-ai/sdk', '@ai-sdk/anthropic'], python: ['anthropic'], notable: true },
  Gemini: { node: ['@google/generative-ai', '@google/genai', '@ai-sdk/google'], python: ['google-generativeai', 'google-genai'], notable: true },
  LangChain: { node: ['langchain', '@langchain/core'], python: ['langchain', 'langchain-core'], notable: true },
  LlamaIndex: { node: ['llamaindex'], python: ['llama-index', 'llama-index-core'], notable: true },
  'Hugging Face': { python: ['transformers', 'huggingface-hub'], node: ['@huggingface/inference'] },
  PyTorch: { python: ['torch'], notable: true },
  TensorFlow: { python: ['tensorflow', 'tensorflow-cpu'], node: ['@tensorflow/tfjs'], notable: true },
  Keras: { python: ['keras'] },
  'scikit-learn': { python: ['scikit-learn'] },
  Pandas: { python: ['pandas'] },
  NumPy: { python: ['numpy'] },
  Matplotlib: { python: ['matplotlib'] },
  OpenCV: { python: ['opencv-python', 'opencv-python-headless', 'opencv-contrib-python'] },
  Streamlit: { python: ['streamlit'], notable: true },
  Gradio: { python: ['gradio'], notable: true },
  Jest: { node: ['jest'] },
  Vitest: { node: ['vitest'] },
  Mocha: { node: ['mocha'] },
  Pytest: { python: ['pytest'] },
  Playwright: { node: ['@playwright/test', 'playwright'], python: ['playwright', 'pytest-playwright'] },
  Cypress: { node: ['cypress'] },
  Docker: { files: /(^|\/)(Dockerfile|[\w.-]+\.Dockerfile|(docker-)?compose(\.[\w-]+)?\.ya?ml)$/ },
  'Docker Compose': { files: /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/ },
  'GitHub Actions': { files: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
  Python: { files: /(^|\/)(pyproject\.toml|requirements[\w-]*\.txt|setup\.py|Pipfile)$/ },
  Go: { files: /(^|\/)go\.mod$/ },
  Rust: { files: /(^|\/)Cargo\.toml$/ },
  // Deployment platforms (Vercel, Netlify...) are deliberately absent: they need no file in the repo,
  // so a missing vercel.json proves nothing.
  Terraform: { files: /\.tf$/ },
};

function checkTech(set: ClaimSet, s: RepoSnapshot, f: RepoFacts, intel: Intelligence): void {
  const deps = new Map<string, RepoEvidence>();
  for (const d of f.dependencies) {
    const key = `${d.value.ecosystem}:${d.value.ecosystem === 'python' ? normalizePyName(d.value.name) : d.value.name}`;
    if (!deps.has(key)) deps.set(key, d.evidence);
  }
  const mentioned = new Map(intel.techStack.map((t) => [t.name, t]));

  const findSignal = (sig: TechSignal): RepoEvidence[] => {
    const ev: RepoEvidence[] = [];
    for (const eco of ['node', 'python', 'go', 'rust'] as const) {
      for (const name of sig[eco] ?? []) {
        const hit = deps.get(`${eco}:${eco === 'python' ? normalizePyName(name) : name}`);
        if (hit) ev.push(hit);
      }
    }
    if (sig.images) for (const svc of f.composeServices) if (svc.value.image && sig.images.test(svc.value.image)) ev.push(svc.evidence);
    if (sig.images) for (const img of f.dockerBaseImages) if (sig.images.test(img.value)) ev.push(img.evidence);
    if (sig.files) {
      const file = s.tree.find((p) => sig.files!.test(p));
      if (file) ev.push(evidenceOf(s, file));
    }
    return ev;
  };

  for (const [name, item] of mentioned) {
    const sig = TECH_SIGNALS[name];
    if (!sig) continue;
    const ev = findSignal(sig);
    const readmeRef = item.evidence[0]!.source;
    if (ev.length > 0) {
      set.add({ id: `tech:${name}`, category: 'tech', status: 'verified', title: `${name} is used by the repository`, detail: `Confirmed by ${ev.map((e) => e.path).filter((p, i, a) => a.indexOf(p) === i).join(', ')}.`, readme: [readmeRef], repo: ev.slice(0, 3) });
    } else {
      const ecoKnown = (['node', 'python', 'go', 'rust'] as const).some((eco) => sig[eco] && f.ecosystems.includes(eco));
      set.add({
        id: `tech:${name}`,
        category: 'tech',
        status: (ecoKnown || sig.files) && !s.truncated ? 'readme-only' : 'unverified',
        title: `${name} is mentioned but not found in the repository`,
        detail: ecoKnown ? 'Not listed in the inspected dependency manifests. It may be outdated, optional, or installed elsewhere.' : sig.files ? 'The file that would confirm it was not found in the tree.' : 'No manifest for this ecosystem was inspected.',
        readme: [readmeRef],
        repo: [],
      });
    }
  }

  // Notable technologies the repository uses that the README never mentions.
  for (const [name, sig] of Object.entries(TECH_SIGNALS)) {
    if (!sig.notable || mentioned.has(name)) continue;
    const ev = findSignal({ ...sig, files: undefined });
    const prod = ev.filter((e) => !f.dependencies.some((d) => d.evidence === e && d.value.dev));
    if (prod.length === 0) continue;
    set.add({ id: `tech:${name}`, category: 'tech', status: 'repo-only', title: `Uses ${name}, README does not mention it`, detail: `Found in ${prod.map((e) => e.path).filter((p, i, a) => a.indexOf(p) === i).join(', ')}.`, readme: [], repo: prod.slice(0, 3) });
  }
}

// ------------------------------------------------------------------ Docker, CI, license, contributing

function checkDocker(set: ClaimSet, s: RepoSnapshot, f: RepoFacts, intel: Intelligence): void {
  const dockerCmds = intel.commands.filter((c) => /^(sudo\s+)?(docker|docker-compose|podman)\b/.test(c.command));
  const composeCmd = dockerCmds.find((c) => /\b(docker-compose|docker compose|podman-compose)\b/.test(c.command) && !/\s(-f|--file)\s/.test(c.command));
  const buildCmd = dockerCmds.find((c) => /\bdocker build\b/.test(c.command) && !/\s(-f|--file)\s/.test(c.command));
  const anyCompose = s.tree.find((p) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(p));
  const anyDockerfile = s.tree.find((p) => /(^|\/)(Dockerfile|[\w.-]+\.Dockerfile)$/.test(p));

  if (composeCmd) {
    if (f.composeFiles.length > 0 || anyCompose) {
      set.add({ id: 'docker:compose', category: 'docker', status: 'verified', title: 'Docker Compose file exists', detail: `${(f.composeFiles[0]?.value ?? anyCompose)!} backs \`${composeCmd.command}\`.`, readme: [composeCmd.source], repo: [f.composeFiles[0]?.evidence ?? evidenceOf(s, anyCompose!)] });
    } else if (!s.truncated) {
      set.add({ id: 'docker:compose', category: 'docker', status: 'contradiction', title: `\`${composeCmd.command}\` but there is no Compose file`, detail: 'No docker-compose.yml or compose.yaml in the repository.', readme: [composeCmd.source], repo: [] });
    }
  }
  if (buildCmd) {
    if (f.dockerfiles.length > 0 || anyDockerfile) {
      set.add({ id: 'docker:build', category: 'docker', status: 'verified', title: 'Dockerfile exists', detail: `${(f.dockerfiles[0]?.value ?? anyDockerfile)!} backs \`${buildCmd.command}\`.`, readme: [buildCmd.source], repo: [f.dockerfiles[0]?.evidence ?? evidenceOf(s, anyDockerfile!)] });
    } else if (!s.truncated) {
      set.add({ id: 'docker:build', category: 'docker', status: 'contradiction', title: `\`${buildCmd.command}\` but there is no Dockerfile`, detail: 'No Dockerfile in the repository.', readme: [buildCmd.source], repo: [] });
    }
  }
  const mentionsDocker = dockerCmds.length > 0 || intel.techStack.some((t) => t.name === 'Docker' || t.name === 'Docker Compose');
  if (!mentionsDocker && (f.dockerfiles.length > 0 || f.composeFiles.length > 0)) {
    const ev = [...f.dockerfiles, ...f.composeFiles].map((x) => x.evidence);
    set.add({ id: 'docker:undocumented', category: 'docker', status: 'repo-only', title: 'Docker setup exists but the README does not explain it', detail: `Found ${ev.map((e) => e.path).join(', ')}.`, readme: [], repo: ev });
  }
}

function checkCi(set: ClaimSet, f: RepoFacts, intel: Intelligence): void {
  if (f.ciCommands.length === 0) return;
  const ciTests = f.ciCommands.filter((c) => categorizeCommand(c.value) === 'test');
  if (ciTests.length === 0) return;
  const readmeTests = intel.commands.filter((c) => c.category === 'test');
  if (readmeTests.length === 0) {
    set.add({ id: 'ci:tests', category: 'ci', status: 'repo-only', title: `CI runs tests (\`${ciTests[0]!.value}\`), README does not explain how`, detail: 'Add a Testing section with the same command CI uses.', readme: [], repo: ciTests.slice(0, 3).map((c) => c.evidence) });
    return;
  }
  const scriptOf = (cmd: string) => scriptReference(cmd)?.script ?? cmd.split(/\s+/)[0];
  const match = readmeTests.find((r) => ciTests.some((c) => c.value === r.command || scriptOf(c.value) === scriptOf(r.command)));
  if (match) {
    const ci = ciTests.find((c) => c.value === match.command || scriptOf(c.value) === scriptOf(match.command))!;
    set.add({ id: 'ci:tests', category: 'ci', status: 'verified', title: 'README test command matches CI', detail: `CI runs \`${ci.value}\`.`, readme: [match.source], repo: [ci.evidence] });
  } else {
    set.add({ id: 'ci:tests', category: 'ci', status: 'unverified', title: 'README and CI run tests differently', detail: `README: \`${readmeTests[0]!.command}\`. CI: \`${ciTests[0]!.value}\`. Check that both still work.`, readme: [readmeTests[0]!.source], repo: [ciTests[0]!.evidence] });
  }
}

/** Normalise a license name to a family for comparison. */
export function licenseFamily(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const families: [string, RegExp][] = [
    ['0bsd', /0bsd/], ['agpl', /agpl|affero/], ['lgpl', /lgpl|lesser/], ['gpl', /gpl|general public/], ['apache', /apache/],
    ['mit', /\bmit\b/], ['bsd', /bsd/], ['isc', /\bisc\b/], ['mpl', /mpl|mozilla/], ['unlicense', /unlicense/], ['cc0', /cc0/],
    ['cc-by', /cc[ -]by|creative commons/], ['epl', /epl|eclipse/], ['bsl', /boost/], ['zlib', /zlib/], ['wtfpl', /wtfpl/], ['eupl', /eupl/],
  ];
  return families.find(([, re]) => re.test(n))?.[0] ?? null;
}

function checkLicense(set: ClaimSet, s: RepoSnapshot, f: RepoFacts, intel: Intelligence): void {
  const readmeLicense = intel.license;
  if (readmeLicense && f.licenseFile) {
    const a = licenseFamily(readmeLicense.value);
    const b = licenseFamily(f.licenseName);
    if (a && b && a !== b) {
      const snippetFamily = licenseFamily(f.licenseFile.evidence.kind === 'content' ? f.licenseFile.evidence.snippet : null);
      const status = snippetFamily === a ? 'verified' : snippetFamily === b ? 'contradiction' : 'unverified';
      set.add({ id: 'license', category: 'license', status, title: `README says ${readmeLicense.value}, LICENSE file says ${f.licenseName}`, detail: status === 'verified' ? 'The LICENSE evidence also contains the README license.' : 'The license evidence is not explicit enough to confirm a conflict.', readme: [readmeLicense.source], repo: [f.licenseFile.evidence] });
    } else if (a && b) {
      set.add({ id: 'license', category: 'license', status: 'verified', title: `License matches: ${f.licenseName}`, detail: `${f.licenseFile.value} confirms the README.`, readme: [readmeLicense.source], repo: [f.licenseFile.evidence] });
    } else {
      set.add({ id: 'license', category: 'license', status: 'unverified', title: 'License file exists but its type could not be compared', detail: `README: ${readmeLicense.value}. ${f.licenseFile.value}: ${f.licenseName ?? 'unrecognised text'}.`, readme: [readmeLicense.source], repo: [f.licenseFile.evidence] });
    }
  } else if (readmeLicense && !f.licenseFile && !s.truncated) {
    set.add({ id: 'license', category: 'license', status: 'readme-only', title: `README states ${readmeLicense.value}, but there is no LICENSE file`, detail: 'Without a LICENSE file GitHub does not show the license and some users cannot legally reuse the code.', readme: [readmeLicense.source], repo: [] });
  } else if (!readmeLicense && f.licenseFile) {
    set.add({ id: 'license', category: 'license', status: 'repo-only', title: `Repository is licensed${f.licenseName ? ` under ${f.licenseName}` : ''}, README does not say`, detail: `Mention the license and link ${f.licenseFile.value}.`, readme: [], repo: [f.licenseFile.evidence] });
  }
  if (f.contributingFile && !intel.hasContributing) {
    set.add({ id: 'contributing', category: 'contributing', status: 'repo-only', title: 'CONTRIBUTING guide exists, README does not link it', detail: `Link ${f.contributingFile.value} from the README.`, readme: [], repo: [f.contributingFile.evidence] });
  }
}

// ------------------------------------------------------------------ links, images and referenced files

function repoPathFromUrl(s: RepoSnapshot, url: string): { path: string; kind: 'blob' | 'tree' | 'raw' } | null {
  const enc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const blob = new RegExp(`^https://github\\.com/${enc(s.owner)}/${enc(s.repo)}/(blob|tree)/${enc(s.ref)}/(.+)$`, 'i').exec(url);
  const raw = new RegExp(`^https://raw\\.githubusercontent\\.com/${enc(s.owner)}/${enc(s.repo)}/${enc(s.ref)}/(.+)$`, 'i').exec(url);
  const rest = blob ? blob[2]! : raw ? raw[1]! : null;
  if (!rest) return null;
  let path = rest.split(/[?#]/)[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep raw */
  }
  return { path: path.replace(/\/+$/, ''), kind: blob ? (blob[1] as 'blob' | 'tree') : 'raw' };
}

function checkLinks(set: ClaimSet, s: RepoSnapshot, intel: Intelligence, hast: HastRoot | undefined): void {
  if (s.truncated) return;
  const check = (url: string, source: SourceRef, what: 'link' | 'image') => {
    const target = repoPathFromUrl(s, url);
    if (!target || !target.path) return;
    const exists = s.tree.includes(target.path) || s.tree.some((p) => p.startsWith(`${target.path}/`));
    const id = `${what}:${target.path}`;
    if (exists) {
      set.add({ id, category: 'link', status: 'verified', title: `${what === 'image' ? 'Image' : 'Link'} target exists: ${target.path}`, detail: 'The file is in the repository.', readme: [source], repo: [evidenceOf(s, target.path)] });
    } else {
      set.add({ id, category: 'link', status: 'unverified', title: `Missing ${what}: ${target.path}`, detail: `The README ${what === 'image' ? 'shows an image' : 'links to a file'} that was not found in the inspected repository tree.`, readme: [source], repo: [] });
    }
  };
  for (const l of intel.links) check(l.url, l.source, 'link');
  if (!hast) return;
  const stack: (HastRoot | Element)[] = [hast];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.tagName === 'img' && typeof child.properties?.src === 'string') {
        const line = Number(child.properties.dataLine) || 0;
        check(child.properties.src, { headingPath: [], line }, 'image');
      }
      stack.push(child);
    }
  }
}

/** Files and directories that README commands expect to exist. */
export function referencedPaths(command: string): { path: string; kind: 'file' | 'dir' }[] {
  const out: { path: string; kind: 'file' | 'dir' }[] = [];
  const ok = (p: string) => p && !/[<>{}$*~%`|]|^-/.test(p) && !/^(\/|https?:)/.test(p) && !/(^|\/)(dist|build|out|target|node_modules|\.venv|venv|env|__pycache__)(\/|$)/.test(p);
  const cmd = command.replace(/^sudo\s+/, '');
  let m: RegExpExecArray | null;
  if ((m = /^(?:cp|mv)\s+(?:-\w+\s+)*(\S+)\s+\S+/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /\s-r\s+(\S+\.(?:txt|in))\b/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /\b(?:docker[- ]compose|docker)\b.*?\s(?:-f|--file)\s+(\S+)/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /^(?:python3?|py)\s+(?!-)(\S+\.py)\b/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /^(?:node|tsx|ts-node|bun|deno run(?:\s+-\S+)*)\s+(?!-)(\S+\.(?:js|mjs|cjs|ts))\b/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /^(?:bash|sh|zsh)\s+(\S+\.sh)\b/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /^\.\/(\S+\.(?:sh|py))\b/.exec(cmd)) && ok(m[1]!)) out.push({ path: m[1]!, kind: 'file' });
  if ((m = /^cd\s+(\S+)$/.exec(cmd)) && ok(m[1]!) && m[1] !== '..' && m[1] !== '.') out.push({ path: m[1]!, kind: 'dir' });
  return out;
}

function checkReferencedFiles(set: ClaimSet, s: RepoSnapshot, commands: CommandItem[]): void {
  if (s.truncated) return;
  const created = new Set<string>();
  const repoName = s.repo.toLowerCase().replace(/\.git$/, '');
  for (const c of commands) {
    // Files the README itself creates are not expected to exist.
    const dest = /^(?:cp|mv)\s+(?:-\w+\s+)*\S+\s+(\S+)/.exec(c.command)?.[1] ?? /^mkdir\s+(?:-p\s+)?(\S+)/.exec(c.command)?.[1] ?? /^(?:python3?|py)\s+-m\s+venv\s+(\S+)/.exec(c.command)?.[1];
    for (const ref of referencedPaths(c.command)) {
      if (created.has(ref.path)) continue;
      if (ref.kind === 'dir' && (ref.path.toLowerCase() === repoName || ref.path.toLowerCase().endsWith(`/${repoName}`))) continue;
      const hit = ref.kind === 'dir' ? treeHasDir(s, ref.path) ?? (s.tree.some((p) => p.includes(`/${ref.path.replace(/^\.\//, '')}/`)) ? ref.path : null) : treeHasFile(s, ref.path) ?? treeHasTail(s, ref.path);
      const id = `file:${ref.path}`;
      if (hit) {
        set.add({ id, category: 'file', status: 'verified', title: `\`${c.command}\` uses an existing ${ref.kind === 'dir' ? 'folder' : 'file'}`, detail: `${hit} exists.`, readme: [c.source], repo: [evidenceOf(s, hit)] });
      } else {
        set.add({ id, category: 'file', status: 'unverified', title: `\`${c.command}\` refers to an unchecked ${ref.kind === 'dir' ? 'folder' : 'file'}: ${ref.path}`, detail: `${ref.path} was not found in the inspected repository tree.`, readme: [c.source], repo: [] });
      }
    }
    if (dest) created.add(dest);
  }
}

// ------------------------------------------------------------------ entry point

const ORDER: Record<ClaimStatus, number> = { contradiction: 0, 'readme-only': 1, 'repo-only': 2, unverified: 3, verified: 4 };

function hasExplicitContradictionEvidence(claim: Claim): boolean {
  return claim.repo.some((evidence) => {
    if (evidence.kind === 'content') return evidence.line > 0 && evidence.snippet.trim().length > 0 && evidence.snippet.trim() !== evidence.path;
    if (evidence.kind === 'tree-absence') return evidence.treeTruncated === false;
    return false;
  });
}

export function checkRepository(input: RealityInput, snapshot: RepoSnapshot): RealityReport {
  const facts = extractRepoFacts(snapshot);
  const set = new ClaimSet();
  const intel = input.intelligence;
  const steps: [string, () => void][] = [
    ['scripts', () => checkScripts(set, snapshot, facts, intel.commands)],
    ['package manager', () => checkPackageManager(set, facts, intel.commands)],
    ['python manager', () => checkPythonManager(set, facts, intel.commands)],
    ['runtimes', () => checkRuntimes(set, facts, intel)],
    ['env', () => checkEnv(set, facts, intel)],
    ['tech', () => checkTech(set, snapshot, facts, intel)],
    ['docker', () => checkDocker(set, snapshot, facts, intel)],
    ['ci', () => checkCi(set, facts, intel)],
    ['license', () => checkLicense(set, snapshot, facts, intel)],
    ['links', () => checkLinks(set, snapshot, intel, input.hast)],
    ['files', () => checkReferencedFiles(set, snapshot, intel.commands)],
  ];
  for (const [, run] of steps) {
    try {
      run();
    } catch {
      // One failing check never hides the others.
    }
  }

  for (const claim of set.claims.values()) {
    if (claim.status === 'contradiction' && !hasExplicitContradictionEvidence(claim)) claim.status = 'unverified';
  }
  const claims = [...set.claims.values()].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  const counts: Record<ClaimStatus, number> = { verified: 0, contradiction: 0, 'readme-only': 0, 'repo-only': 0, unverified: 0 };
  for (const c of claims) counts[c.status]++;

  return {
    snapshot: { owner: snapshot.owner, repo: snapshot.repo, ref: snapshot.ref, baseDir: snapshot.baseDir, truncated: snapshot.truncated, fileCount: Object.keys(snapshot.files).length, treeSize: snapshot.tree.length },
    claims,
    counts,
    readiness: computeReadiness(intel, facts, claims),
    facts,
  };
}

