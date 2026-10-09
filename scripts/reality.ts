/**
 * pnpm reality [dir] [options]
 * Runs the Repository Reality Check on a local checkout: no GitHub API, no network.
 * With --base it compares two checkouts (e.g. target branch vs pull request) and reports
 * documentation drift: contradictions the change introduces or resolves.
 *
 * Options
 *   --readme <path>        README path relative to the repo root (default: README.md, readme.md, docs/README.md...)
 *   --base <dir>           base checkout to compare against (enables drift mode)
 *   --repo <owner/repo>    used for evidence links (default: $GITHUB_REPOSITORY or the git "origin" remote)
 *   --ref <ref>            revision label for links (default: $GITHUB_SHA or `git rev-parse HEAD`)
 *   --format text|md|json  output format (default text)
 *   --out <file>           write the report to a file instead of stdout
 *   --fail-on none|contradiction|new-contradiction   exit 1 on these (default none)
 *   --min-readiness <n>    exit 1 when Setup Readiness is below n
 *   --title <text>         heading for the markdown report
 *
 * Examples
 *   pnpm reality ../my-project
 *   pnpm reality ./head --base ./base --format md --out drift.md --fail-on new-contradiction
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  analyzeReadme,
  buildGitHubSource,
  buildLocalSnapshot,
  checkRepository,
  diffRealityReports,
  renderRealityMarkdown,
  renderRealityText,
  shouldFail,
  type FailOn,
  type RealityReport,
} from '../packages/core/src/index';

interface Args {
  dir: string;
  readme?: string;
  base?: string;
  repo?: string;
  ref?: string;
  format: 'text' | 'md' | 'json';
  out?: string;
  failOn: FailOn;
  minReadiness?: number;
  title?: string;
}

function usage(message: string): never {
  console.error(`reality: ${message}\nRun "pnpm reality --help" for options.`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: '.', format: 'text', failOn: 'none' };
  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--':
        break;
      case '--help':
      case '-h':
        console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!.replace(/^\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
        process.exit(0);
        break;
      case '--readme':
        args.readme = value();
        break;
      case '--base':
        args.base = value();
        break;
      case '--repo':
        args.repo = value();
        break;
      case '--ref':
        args.ref = value();
        break;
      case '--format': {
        const f = value();
        if (f !== 'text' && f !== 'md' && f !== 'json') usage(`unknown format "${f}"`);
        args.format = f;
        break;
      }
      case '--out':
        args.out = value();
        break;
      case '--fail-on': {
        const f = value();
        if (f !== 'none' && f !== 'contradiction' && f !== 'new-contradiction') usage(`unknown --fail-on "${f}"`);
        args.failOn = f;
        break;
      }
      case '--min-readiness': {
        const n = Number(value());
        if (!Number.isFinite(n) || n < 0 || n > 100) usage('--min-readiness must be 0-100');
        args.minReadiness = n;
        break;
      }
      case '--title':
        args.title = value();
        break;
      default:
        if (a.startsWith('--')) usage(`unknown option ${a}`);
        if (positional++ > 0) usage(`unexpected argument ${a}`);
        args.dir = a;
    }
  }
  return args;
}

function git(dir: string, ...cmd: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', 'target', 'coverage']);

/** Tracked files (what GitHub would show). Falls back to a directory walk outside git. */
function listFiles(root: string): { path: string; size: number }[] {
  const tracked = git(root, 'ls-files', '-z', '--cached');
  const paths =
    tracked !== null && tracked.length > 0
      ? tracked.split('\0').filter(Boolean)
      : (() => {
          const out: string[] = [];
          const walk = (rel: string) => {
            for (const d of readdirSync(path.join(root, rel), { withFileTypes: true })) {
              const p = rel ? `${rel}/${d.name}` : d.name;
              if (d.isDirectory()) {
                if (!SKIP_DIRS.has(d.name)) walk(p);
              } else if (d.isFile()) out.push(p);
            }
          };
          walk('');
          return out;
        })();
  const files: { path: string; size: number }[] = [];
  for (const p of paths) {
    try {
      const st = statSync(path.join(root, p));
      if (st.isFile()) files.push({ path: p.split(path.sep).join('/'), size: st.size });
    } catch {
      /* deleted in the working tree: skip */
    }
  }
  return files;
}

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README', 'docs/README.md', '.github/README.md'];

function findReadme(root: string, files: { path: string }[], wanted?: string): string | null {
  const set = new Set(files.map((f) => f.path));
  if (wanted) return set.has(wanted) || existsSync(path.join(root, wanted)) ? wanted : null;
  return README_CANDIDATES.find((c) => set.has(c)) ?? null;
}

function repoFromRemote(root: string): string | null {
  const url = git(root, 'remote', 'get-url', 'origin');
  const m = url ? /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

interface RunResult {
  report: RealityReport;
  readmePath: string;
  skipped: string[];
}

function runOn(root: string, readmeWanted: string | undefined, owner: string, repo: string, ref: string): RunResult | null {
  const files = listFiles(root);
  const readmePath = findReadme(root, files, readmeWanted);
  if (!readmePath) return null;
  const markdown = readFileSync(path.join(root, readmePath), 'utf8');
  const source = buildGitHubSource(owner, repo, ref, readmePath);
  const analysis = analyzeReadme(markdown, source);
  const { snapshot, skipped } = buildLocalSnapshot({
    owner,
    repo,
    ref,
    readmePath,
    entries: files,
    readFile: (p) => {
      try {
        return readFileSync(path.join(root, p), 'utf8');
      } catch {
        return null;
      }
    },
  });
  return { report: checkRepository({ intelligence: analysis.intelligence, hast: analysis.hast }, snapshot), readmePath, skipped };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // pnpm runs scripts from the workspace root; resolve paths from where the user typed the command.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = path.resolve(cwd, args.dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) usage(`not a directory: ${args.dir}`);

  const repoFull = args.repo ?? process.env.GITHUB_REPOSITORY ?? repoFromRemote(root);
  const links = !!repoFull && /^[\w.-]+\/[\w.-]+$/.test(repoFull);
  const [owner, repo] = links ? (repoFull!.split('/') as [string, string]) : ['local', path.basename(root) || 'repo'];
  const ref = args.ref ?? process.env.GITHUB_SHA ?? git(root, 'rev-parse', 'HEAD') ?? 'HEAD';

  const head = runOn(root, args.readme, owner, repo, ref);
  if (!head) usage(`no README found in ${args.dir}${args.readme ? ` at ${args.readme}` : ''}`);

  let base: RunResult | null = null;
  if (args.base) {
    const baseRoot = path.resolve(cwd, args.base);
    if (!existsSync(baseRoot)) usage(`not a directory: ${args.base}`);
    // Same README path as head, so the comparison is like for like. A missing base README = no diff.
    base = runOn(baseRoot, head.readmePath, owner, repo, git(baseRoot, 'rev-parse', 'HEAD') ?? 'base');
    if (!base) console.error(`reality: base has no ${head.readmePath}; reporting head only.`);
  }

  const diff = base ? diffRealityReports(base.report, head.report) : null;
  const decision = shouldFail(head.report, diff, args.failOn, args.minReadiness);

  let output: string;
  if (args.format === 'json') {
    const { facts: _facts, ...report } = head.report;
    output = JSON.stringify({ readmePath: head.readmePath, report, diff, skipped: head.skipped, decision }, null, 2);
  } else if (args.format === 'md') {
    output = renderRealityMarkdown(head.report, diff, { readmePath: head.readmePath, links, title: args.title });
  } else {
    output = `${renderRealityText(head.report, diff)}\n\n${decision.fail ? 'FAIL' : 'OK'}: ${decision.reason}`;
  }

  if (args.out) {
    writeFileSync(path.resolve(cwd, args.out), output.endsWith('\n') ? output : `${output}\n`);
    console.log(`Wrote ${args.out}. ${decision.fail ? 'FAIL' : 'OK'}: ${decision.reason}`);
  } else {
    console.log(output);
  }
  process.exitCode = decision.fail ? 1 : 0;
}

main();
