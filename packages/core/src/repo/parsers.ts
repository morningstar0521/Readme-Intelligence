/**
 * Small, deterministic parsers for repository files. Each returns plain data with 1-based
 * line numbers so every fact can be linked to the exact line on GitHub. They never throw:
 * malformed input yields empty results. No full TOML / YAML parser is used on purpose:
 * only the few keys we need are read, line by line.
 */

export interface Lined<T> {
  value: T;
  line: number;
  snippet: string;
}

const lines = (content: string) => content.replace(/\r\n?/g, '\n').split('\n');

/** First line (1-based) matching a regex, optionally only after a given line. 0 if none. */
export function lineOfMatch(content: string, re: RegExp, after = 0): number {
  const ls = lines(content);
  for (let i = after; i < ls.length; i++) if (re.test(ls[i]!)) return i + 1;
  return 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function snippetAt(content: string, line: number): string {
  return line > 0 ? (lines(content)[line - 1] ?? '').trim().slice(0, 160) : '';
}

function objectSnippet(content: string, line: number): string {
  const source = lines(content).slice(line - 1).join('\n');
  const start = source.indexOf('{');
  if (start < 0) return snippetAt(content, line);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1).trim().slice(0, 320);
  }
  return snippetAt(content, line);
}

// ------------------------------------------------------------------ versions

export interface VersionMin {
  minMajor: number | null;
  minMinor: number | null;
}

/**
 * Lowest version allowed by a spec: ">=20.9" -> 20.9, "^18" -> 18, "~3.10" -> 3.10, "20.x" -> 20,
 * "v20.11.0" -> 20.11, ">=3.10,<4" -> 3.10, "18 || 20" -> 18, "lts/*" -> null, "<20" -> null.
 */
export function minVersion(spec: string): VersionMin {
  const alternatives = spec.split('||').map((s) => s.trim()).filter(Boolean);
  let best: VersionMin = { minMajor: null, minMinor: null };
  for (const alt of alternatives) {
    let found: VersionMin | null = null;
    for (const part of alt.split(/[,\s]+/).filter(Boolean)) {
      if (/^<|^!=/.test(part)) continue;
      const m = /(\d+)(?:\.(\d+|x|\*))?/.exec(part);
      if (!m) continue;
      found = { minMajor: Number(m[1]), minMinor: m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : null };
      break;
    }
    if (!found) continue;
    if (best.minMajor === null || found.minMajor! < best.minMajor || (found.minMajor === best.minMajor && (found.minMinor ?? 0) < (best.minMinor ?? 0))) {
      best = found;
    }
  }
  return best;
}

// ------------------------------------------------------------------ package.json

export interface PackageJsonInfo {
  name: string | null;
  scripts: Lined<{ name: string; command: string }>[];
  scriptsSection: Lined<string> | null;
  dependencies: Lined<{ name: string; dev: boolean }>[];
  engines: Lined<{ runtime: 'node'; spec: string }>[];
  packageManager: Lined<string> | null;
  workspaces: boolean;
}

export function parsePackageJson(content: string): PackageJsonInfo | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const out: PackageJsonInfo = { name: typeof obj.name === 'string' ? obj.name : null, scripts: [], scriptsSection: null, dependencies: [], engines: [], packageManager: null, workspaces: Boolean(obj.workspaces) };

  const sectionLine = (key: string) => lineOfMatch(content, new RegExp(`"${escapeRe(key)}"\\s*:`));
  const keyLine = (section: string, key: string) => {
    const start = sectionLine(section);
    const l = lineOfMatch(content, new RegExp(`"${escapeRe(key)}"\\s*:`), Math.max(0, start - 1));
    return l || start;
  };

  if (obj.scripts && typeof obj.scripts === 'object') {
    const line = sectionLine('scripts');
    if (line > 0) out.scriptsSection = { value: objectSnippet(content, line), line, snippet: objectSnippet(content, line) };
    for (const [name, command] of Object.entries(obj.scripts as Record<string, unknown>)) {
      if (typeof command !== 'string') continue;
      const line = keyLine('scripts', name);
      out.scripts.push({ value: { name, command }, line, snippet: snippetAt(content, line) });
    }
  }
  for (const [section, dev] of [['dependencies', false], ['devDependencies', true], ['peerDependencies', false], ['optionalDependencies', false]] as const) {
    const deps = obj[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      const line = keyLine(section, name);
      out.dependencies.push({ value: { name, dev }, line, snippet: snippetAt(content, line) });
    }
  }
  const engines = obj.engines as Record<string, unknown> | undefined;
  if (engines && typeof engines.node === 'string') {
    const line = keyLine('engines', 'node');
    out.engines.push({ value: { runtime: 'node', spec: engines.node }, line, snippet: snippetAt(content, line) });
  }
  if (typeof obj.packageManager === 'string') {
    const line = sectionLine('packageManager');
    out.packageManager = { value: obj.packageManager, line, snippet: snippetAt(content, line) };
  }
  return out;
}

/** True for the placeholder test script npm init writes. */
export function isPlaceholderTestScript(command: string): boolean {
  return /no test specified/i.test(command);
}

// ------------------------------------------------------------------ Python

/** PEP 503 normalised distribution name. */
export function normalizePyName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

function pyRequirementName(spec: string): string | null {
  const s = spec.trim().replace(/^["']|["'],?$/g, '');
  if (!s || s.startsWith('#') || s.startsWith('-')) return null;
  const egg = /#egg=([A-Za-z0-9_.-]+)/.exec(s);
  if (egg) return normalizePyName(egg[1]!);
  if (/^(git\+|https?:|file:|\.|\/)/.test(s)) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9_.-]*)/.exec(s);
  return m ? normalizePyName(m[1]!) : null;
}

export function parseRequirements(content: string, dev = false): Lined<{ name: string; dev: boolean }>[] {
  const out: Lined<{ name: string; dev: boolean }>[] = [];
  lines(content).forEach((raw, i) => {
    const name = pyRequirementName(raw.replace(/\s+#.*$/, ''));
    if (name) out.push({ value: { name, dev }, line: i + 1, snippet: raw.trim().slice(0, 160) });
  });
  return out;
}

export interface PyprojectInfo {
  dependencies: Lined<{ name: string; dev: boolean }>[];
  requiresPython: Lined<string> | null;
  usesPoetry: Lined<string> | null;
  usesUv: Lined<string> | null;
}

/** Reads [project], [project.optional-dependencies], [dependency-groups] and [tool.poetry.*dependencies]. */
export function parsePyproject(content: string): PyprojectInfo {
  const out: PyprojectInfo = { dependencies: [], requiresPython: null, usesPoetry: null, usesUv: null };
  const ls = lines(content);
  let table = '';
  let inArray: { dev: boolean } | null = null;

  for (let i = 0; i < ls.length; i++) {
    const raw = ls[i]!;
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line) continue;

    if (inArray) {
      for (const m of line.matchAll(/["']([^"']+)["']/g)) {
        const name = pyRequirementName(m[1]!);
        if (name) out.dependencies.push({ value: { name, dev: inArray.dev }, line: i + 1, snippet: raw.trim() });
      }
      if (line.includes(']')) inArray = null;
      continue;
    }

    const header = /^\[{1,2}([^\]]+)\]{1,2}$/.exec(line);
    if (header) {
      table = header[1]!.trim();
      if (/^tool\.poetry(\.|$)/.test(table) && !out.usesPoetry) out.usesPoetry = { value: table, line: i + 1, snippet: raw.trim() };
      if (/^tool\.uv(\.|$)/.test(table) && !out.usesUv) out.usesUv = { value: table, line: i + 1, snippet: raw.trim() };
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.replace(/"/g, '');
    const value = kv[2]!;

    if (table === 'project' && key === 'requires-python') {
      out.requiresPython = { value: value.replace(/["']/g, ''), line: i + 1, snippet: raw.trim() };
      continue;
    }
    const arrayTable = (table === 'project' && key === 'dependencies') || table === 'project.optional-dependencies' || table === 'dependency-groups';
    if (arrayTable && value.startsWith('[')) {
      const dev = table !== 'project';
      for (const m of value.matchAll(/["']([^"']+)["']/g)) {
        const name = pyRequirementName(m[1]!);
        if (name) out.dependencies.push({ value: { name, dev }, line: i + 1, snippet: raw.trim() });
      }
      if (!value.includes(']')) inArray = { dev };
      continue;
    }
    const poetryDeps = /^tool\.poetry\.(dependencies|dev-dependencies|group\.[^.]+\.dependencies)$/.exec(table);
    if (poetryDeps) {
      if (key === 'python') {
        out.requiresPython = { value: value.replace(/["']/g, '').replace(/[{}]/g, ''), line: i + 1, snippet: raw.trim() };
      } else {
        out.dependencies.push({ value: { name: normalizePyName(key), dev: poetryDeps[1] !== 'dependencies' }, line: i + 1, snippet: raw.trim() });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ Go / Rust

export function parseGoMod(content: string): { goVersion: Lined<string> | null; dependencies: Lined<string>[] } {
  let goVersion: Lined<string> | null = null;
  const deps: Lined<string>[] = [];
  let inRequire = false;
  lines(content).forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const go = /^go\s+(\d+\.\d+(?:\.\d+)?)/.exec(line);
    if (go) goVersion = { value: go[1]!, line: i + 1, snippet: raw.trim() };
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      return;
    }
    if (inRequire && line === ')') {
      inRequire = false;
      return;
    }
    const req = inRequire ? /^(\S+)\s+v/.exec(line) : /^require\s+(\S+)\s+v/.exec(line);
    if (req) deps.push({ value: req[1]!, line: i + 1, snippet: raw.trim() });
  });
  return { goVersion, dependencies: deps };
}

export function parseCargoToml(content: string): { dependencies: Lined<{ name: string; dev: boolean }>[]; rustVersion: Lined<string> | null } {
  const deps: Lined<{ name: string; dev: boolean }>[] = [];
  let rustVersion: Lined<string> | null = null;
  let table = '';
  lines(content).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = header[1]!;
      return;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (!kv) return;
    if (table === 'package' && kv[1] === 'rust-version') rustVersion = { value: line.split('=')[1]!.replace(/["'\s]/g, ''), line: i + 1, snippet: raw.trim() };
    if (/^(dependencies|dev-dependencies|build-dependencies|workspace\.dependencies)$/.test(table)) {
      deps.push({ value: { name: kv[1]!, dev: table !== 'dependencies' && table !== 'workspace.dependencies' }, line: i + 1, snippet: raw.trim() });
    }
  });
  return { dependencies: deps, rustVersion };
}

// ------------------------------------------------------------------ runtime pin files

export function parseRuntimeFile(path: string, content: string): Lined<{ runtime: 'node' | 'python' | 'rust' | 'ruby' | 'java' | 'go'; spec: string }>[] {
  const name = path.split('/').pop()!;
  const first = lines(content).findIndex((l) => l.trim() && !l.trim().startsWith('#'));
  if (first === -1) return [];
  const text = lines(content)[first]!.trim();
  const at = (runtime: 'node' | 'python' | 'rust' | 'ruby' | 'java' | 'go', spec: string, line = first + 1) => ({ value: { runtime, spec }, line, snippet: spec });
  if (name === '.nvmrc' || name === '.node-version') return [at('node', text)];
  if (name === '.python-version') return [at('python', text)];
  if (name === 'runtime.txt') {
    const m = /^python-(\S+)/.exec(text);
    return m ? [at('python', m[1]!)] : [];
  }
  if (name.startsWith('rust-toolchain')) {
    const m = /channel\s*=\s*"([^"]+)"/.exec(content) ?? /^(\d[\w.]*)$/.exec(text);
    return m ? [at('rust', m[1]!)] : [];
  }
  if (name === '.tool-versions') {
    const out: Lined<{ runtime: 'node' | 'python' | 'rust' | 'ruby' | 'java' | 'go'; spec: string }>[] = [];
    const map: Record<string, 'node' | 'python' | 'rust' | 'ruby' | 'java' | 'go'> = { nodejs: 'node', node: 'node', python: 'python', rust: 'rust', ruby: 'ruby', java: 'java', golang: 'go' };
    lines(content).forEach((l, i) => {
      const m = /^(\S+)\s+(\S+)/.exec(l.trim());
      if (m && map[m[1]!]) out.push(at(map[m[1]!]!, m[2]!, i + 1));
    });
    return out;
  }
  return [];
}

// ------------------------------------------------------------------ Docker

export function parseDockerfile(content: string): { baseImages: Lined<string>[]; exposed: Lined<number>[] } {
  const baseImages: Lined<string>[] = [];
  const exposed: Lined<number>[] = [];
  lines(content).forEach((raw, i) => {
    const line = raw.trim();
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line);
    if (from && !/^\$/.test(from[1]!)) baseImages.push({ value: from[1]!.toLowerCase(), line: i + 1, snippet: line });
    const expose = /^EXPOSE\s+(.+)$/i.exec(line);
    if (expose) for (const p of expose[1]!.split(/\s+/)) if (/^\d+/.test(p)) exposed.push({ value: parseInt(p, 10), line: i + 1, snippet: line });
  });
  return { baseImages, exposed };
}

/** Runtime implied by a base image, e.g. node:20-alpine -> node 20, python:3.11-slim -> python 3.11. */
export function runtimeFromImage(image: string): { runtime: 'node' | 'python' | 'go' | 'ruby' | 'java'; spec: string } | null {
  const m = /^(?:docker\.io\/)?(?:library\/)?(node|python|golang|ruby|openjdk|eclipse-temurin|amazoncorretto):(\d+(?:\.\d+)?)/.exec(image);
  if (!m) return null;
  const map: Record<string, 'node' | 'python' | 'go' | 'ruby' | 'java'> = { node: 'node', python: 'python', golang: 'go', ruby: 'ruby', openjdk: 'java', 'eclipse-temurin': 'java', amazoncorretto: 'java' };
  return { runtime: map[m[1]!]!, spec: m[2]! };
}

/** Service names and images from a Compose file (line based; only the `services:` block). */
export function parseCompose(content: string): Lined<{ name: string; image: string | null }>[] {
  const ls = lines(content);
  const out: Lined<{ name: string; image: string | null }>[] = [];
  const start = ls.findIndex((l) => /^services:\s*$/.test(l));
  if (start === -1) return out;
  let serviceIndent: number | null = null;
  let current: Lined<{ name: string; image: string | null }> | null = null;
  for (let i = start + 1; i < ls.length; i++) {
    const raw = ls[i]!;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    if (serviceIndent === null) serviceIndent = indent;
    const key = /^\s*([\w.-]+):\s*$/.exec(raw);
    if (indent === serviceIndent && key) {
      current = { value: { name: key[1]!, image: null }, line: i + 1, snippet: raw.trim() };
      out.push(current);
      continue;
    }
    const image = /^\s*image:\s*["']?([^"'\s]+)/.exec(raw);
    if (current && indent > serviceIndent && image) current.value.image = image[1]!.toLowerCase();
  }
  return out;
}

// ------------------------------------------------------------------ GitHub Actions

export interface WorkflowInfo {
  commands: Lined<string>[];
  runtimes: Lined<{ runtime: 'node' | 'python' | 'go' | 'java'; spec: string }>[];
  /** Package managers set up explicitly (pnpm/action-setup, cache: pnpm, setup-uv...). */
  managers: Lined<string>[];
}

export function parseWorkflow(content: string): WorkflowInfo {
  const out: WorkflowInfo = { commands: [], runtimes: [], managers: [] };
  const ls = lines(content);
  for (let i = 0; i < ls.length; i++) {
    const raw = ls[i]!;
    const run = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(raw);
    if (run) {
      const rest = run[2]!.trim();
      if (/^[|>][-+]?$/.test(rest)) {
        // Block scalar: every following line indented deeper than the "run:" key belongs to it.
        const runCol = raw.indexOf('run:');
        for (let j = i + 1; j < ls.length; j++) {
          const r = ls[j]!;
          if (r.trim() === '') continue;
          const ind = r.length - r.trimStart().length;
          if (ind <= runCol) break;
          const cmd = r.trim();
          if (cmd && !cmd.startsWith('#')) out.commands.push({ value: cmd, line: j + 1, snippet: cmd });
        }
      } else if (rest) {
        out.commands.push({ value: rest.replace(/^["']|["']$/g, ''), line: i + 1, snippet: rest });
      }
    }
    const ver = /^\s*(node|python|go|java)-version:\s*(.+)$/.exec(raw);
    if (ver) {
      const value = ver[2]!.replace(/["'[\]]/g, '').trim();
      if (value && !value.startsWith('${{')) {
        const min = value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .sort((a, b) => (minVersion(a).minMajor ?? 999) - (minVersion(b).minMajor ?? 999))[0];
        if (min) out.runtimes.push({ value: { runtime: ver[1] as 'node' | 'python' | 'go' | 'java', spec: min }, line: i + 1, snippet: raw.trim() });
      }
    }
    if (/uses:\s*pnpm\/action-setup/.test(raw)) out.managers.push({ value: 'pnpm', line: i + 1, snippet: raw.trim() });
    if (/uses:\s*oven-sh\/setup-bun/.test(raw)) out.managers.push({ value: 'bun', line: i + 1, snippet: raw.trim() });
    if (/uses:\s*astral-sh\/setup-uv/.test(raw)) out.managers.push({ value: 'uv', line: i + 1, snippet: raw.trim() });
    const cache = /^\s*cache:\s*["']?(npm|pnpm|yarn|pip|poetry|pipenv)["']?\s*$/.exec(raw);
    if (cache) out.managers.push({ value: cache[1]!, line: i + 1, snippet: raw.trim() });
  }
  return out;
}

// ------------------------------------------------------------------ env

export function parseEnvExample(content: string): Lined<string>[] {
  const out: Lined<string>[] = [];
  const seen = new Set<string>();
  lines(content).forEach((raw, i) => {
    const m = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (!m || seen.has(m[1]!)) return;
    // Commented lines count only when they look like a disabled assignment, not prose.
    if (raw.trim().startsWith('#') && !/^[A-Z][A-Z0-9_]*$/.test(m[1]!)) return;
    seen.add(m[1]!);
    out.push({ value: m[1]!, line: i + 1, snippet: raw.trim().replace(/=.*/, '=') });
  });
  return out;
}

/** Variables provided by runtimes / platforms; reading them is not a documentation gap. */
export const IGNORED_ENV = new Set([
  'NODE_ENV', 'CI', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TERM', 'TZ', 'LANG', 'TMPDIR', 'HOSTNAME',
  'NEXT_RUNTIME', 'NEXT_PHASE', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'NETLIFY', 'RENDER',
  'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_WORKSPACE', 'RUNNER_OS', 'JEST_WORKER_ID',
  'VITEST', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'PYTHONPATH', 'VIRTUAL_ENV', 'APPDATA', 'USERPROFILE',
]);

const ENV_USAGE_RES: RegExp[] = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /(?:Deno\.env\.get|Bun\.env\.get)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /Bun\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /os\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  /(?:os\.environ\.get|os\.getenv|environ\.get|env\.str|env\.int|env\.bool)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /ENV(?:\.fetch)?[([]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /env::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /(?:getenv|env)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\$_(?:ENV|SERVER)\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /Environment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
];

/** Environment variables read by source code (first occurrence per name). */
export function scanEnvUsage(content: string): Lined<string>[] {
  const out: Lined<string>[] = [];
  const seen = new Set<string>();
  const ls = lines(content);
  ls.forEach((raw, i) => {
    if (raw.length > 2000) return;
    for (const re of ENV_USAGE_RES) {
      re.lastIndex = 0;
      for (const m of raw.matchAll(re)) {
        const name = m[1]!;
        if (seen.has(name) || IGNORED_ENV.has(name) || !/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
        seen.add(name);
        out.push({ value: name, line: i + 1, snippet: raw.trim().slice(0, 160) });
      }
    }
    // const { A, B: alias } = process.env
    const destructure = /\{([^}]+)\}\s*=\s*process\.env/.exec(raw);
    if (destructure) {
      for (const part of destructure[1]!.split(',')) {
        const name = part.split(':')[0]!.split('=')[0]!.trim();
        if (/^[A-Z][A-Z0-9_]+$/.test(name) && !seen.has(name) && !IGNORED_ENV.has(name)) {
          seen.add(name);
          out.push({ value: name, line: i + 1, snippet: raw.trim().slice(0, 160) });
        }
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ Makefile

export function parseMakefile(content: string): Lined<string>[] {
  const out: Lined<string>[] = [];
  lines(content).forEach((raw, i) => {
    const m = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/.exec(raw);
    if (m) out.push({ value: m[1]!, line: i + 1, snippet: raw.trim().slice(0, 160) });
  });
  return out;
}
