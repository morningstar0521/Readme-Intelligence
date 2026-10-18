import type { Ecosystem, Located, PackageManager, RepoEvidence, RepoFacts, RepoSnapshot } from './types';
import {
  minVersion,
  parseCargoToml,
  parseCompose,
  parseDockerfile,
  parseEnvExample,
  parseGoMod,
  parseMakefile,
  parsePackageJson,
  parsePyproject,
  parseRequirements,
  parseRuntimeFile,
  parseWorkflow,
  runtimeFromImage,
  scanEnvUsage,
  type Lined,
} from './parsers';
import { LOCKFILES, isContributingPath, isEnvExamplePath, isLicensePath, isSourcePath, isWorkflowPath } from './select';
import { licenseNameIn } from '../extract/meta';

/** GitHub blob URL for a file, optionally pointing at one line. */
export function blobUrl(s: Pick<RepoSnapshot, 'owner' | 'repo' | 'ref'>, path: string, line = 0): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${s.owner}/${s.repo}/blob/${encodeURIComponent(s.ref)}/${encoded}${line > 0 ? `#L${line}` : ''}`;
}

export function evidenceOf(_s: RepoSnapshot, path: string, line = 0, snippet = ''): RepoEvidence {
  if (line === 0 && _s.files[path] !== undefined) {
    line = 1;
    snippet = _s.files[path]!.split(/\r?\n/, 1)[0]!.trim().slice(0, 160);
  }
  return { kind: 'content', path, line, snippet: snippet || path };
}

function located<T>(s: RepoSnapshot, path: string, l: Lined<T>): Located<T> {
  return { value: l.value, evidence: evidenceOf(s, path, l.line, l.snippet) };
}

const baseName = (p: string) => p.split('/').pop()!;
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** True when a path is in the README directory or the repository root (where setup files are expected). */
function inScope(s: RepoSnapshot, path: string): boolean {
  const d = dirName(path);
  return d === '' || d === s.baseDir;
}

export function extractRepoFacts(s: RepoSnapshot): RepoFacts {
  const f: RepoFacts = {
    manifests: [],
    workspaceManifests: [],
    ecosystems: [],
    packageManagers: [],
    lockfiles: [],
    scripts: [],
    scriptSections: [],
    dependencies: [],
    runtimes: [],
    envExample: [],
    envInCode: [],
    dockerfiles: [],
    dockerBaseImages: [],
    composeFiles: [],
    composeServices: [],
    workflows: [],
    ciCommands: [],
    ciRuntimes: [],
    makeTargets: [],
    licenseFile: null,
    licenseName: null,
    contributingFile: null,
    scannedSourceFiles: 0,
  };
  const eco = new Set<Ecosystem>();
  const addManager = (pm: PackageManager, ev: RepoEvidence) => {
    if (!f.packageManagers.some((p) => p.value === pm)) f.packageManagers.push({ value: pm, evidence: ev });
  };
  const addRuntime = (path: string, l: Lined<{ runtime: RepoFacts['runtimes'][number]['value']['runtime']; spec: string }>) => {
    const { minMajor, minMinor } = minVersion(l.value.spec);
    f.runtimes.push({ value: { runtime: l.value.runtime, spec: l.value.spec, minMajor, minMinor }, evidence: evidenceOf(s, path, l.line, l.snippet) });
  };

  // Lockfiles: presence in the tree is enough.
  for (const path of s.tree) {
    const name = baseName(path);
    if (LOCKFILES[name] && inScope(s, path)) {
      f.lockfiles.push({ value: name, evidence: evidenceOf(s, path) });
      addManager(LOCKFILES[name] as PackageManager, evidenceOf(s, path));
    }
    if (!f.licenseFile && isLicensePath(path)) f.licenseFile = { value: path, evidence: evidenceOf(s, path) };
    if (!f.contributingFile && isContributingPath(path)) f.contributingFile = { value: path, evidence: evidenceOf(s, path) };
    if (isWorkflowPath(path)) f.workflows.push({ value: path, evidence: evidenceOf(s, path) });
    if (/(^|\/)(Dockerfile|Dockerfile\.[\w.-]+|[\w.-]+\.Dockerfile)$/.test(path) && inScope(s, path)) f.dockerfiles.push({ value: path, evidence: evidenceOf(s, path) });
    if (/(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(path) && inScope(s, path)) f.composeFiles.push({ value: path, evidence: evidenceOf(s, path) });
    if (/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/.test(path) && inScope(s, path)) {
      eco.add('java');
      f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
      addManager(path.endsWith('pom.xml') ? 'maven' : 'gradle', evidenceOf(s, path));
    }
    if (/(^|\/)[\w.-]+\.(csproj|sln)$/.test(path) && inScope(s, path)) eco.add('dotnet');
  }

  for (const [path, content] of Object.entries(s.files)) {
    const name = baseName(path);
    try {
      if (name === 'package.json') {
        const pkg = parsePackageJson(content);
        if (!pkg) continue;
        eco.add('node');
        const deps = () => {
          for (const d of pkg.dependencies) f.dependencies.push({ value: { name: d.value.name, ecosystem: 'node', dev: d.value.dev }, evidence: evidenceOf(s, path, d.line, d.snippet) });
        };
        if (path !== 'package.json' && path !== `${s.baseDir}/package.json`) {
          // Workspace package: its dependencies count as "the project uses X", its scripts do not run from the README folder.
          f.workspaceManifests.push({ value: path, evidence: evidenceOf(s, path) });
          deps();
          continue;
        }
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        if (pkg.scriptsSection) f.scriptSections.push({ value: path, evidence: evidenceOf(s, path, pkg.scriptsSection.line, pkg.scriptsSection.snippet) });
        for (const sc of pkg.scripts) f.scripts.push(located(s, path, sc));
        deps();
        for (const e of pkg.engines) addRuntime(path, { value: { runtime: 'node', spec: e.value.spec }, line: e.line, snippet: e.snippet });
        if (pkg.packageManager) {
          const pm = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager.value)?.[1] as PackageManager | undefined;
          if (pm) addManager(pm, evidenceOf(s, path, pkg.packageManager.line, pkg.packageManager.snippet));
        }
      } else if (/^(requirements([-_][\w-]+)?\.txt|[\w-]*requirements\.txt)$/.test(name)) {
        eco.add('python');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('pip', evidenceOf(s, path));
        for (const d of parseRequirements(content, /dev|test/.test(name))) {
          f.dependencies.push({ value: { name: d.value.name, ecosystem: 'python', dev: d.value.dev }, evidence: evidenceOf(s, path, d.line, d.snippet) });
        }
      } else if (name === 'pyproject.toml') {
        eco.add('python');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        const py = parsePyproject(content);
        for (const d of py.dependencies) f.dependencies.push({ value: { name: d.value.name, ecosystem: 'python', dev: d.value.dev }, evidence: evidenceOf(s, path, d.line, d.snippet) });
        if (py.requiresPython) addRuntime(path, { value: { runtime: 'python', spec: py.requiresPython.value }, line: py.requiresPython.line, snippet: py.requiresPython.snippet });
        if (py.usesPoetry) addManager('poetry', evidenceOf(s, path, py.usesPoetry.line, py.usesPoetry.snippet));
        if (py.usesUv) addManager('uv', evidenceOf(s, path, py.usesUv.line, py.usesUv.snippet));
      } else if (name === 'Pipfile') {
        eco.add('python');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('pipenv', evidenceOf(s, path));
      } else if (name === 'environment.yml') {
        eco.add('python');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('conda', evidenceOf(s, path));
      } else if (name === 'go.mod') {
        eco.add('go');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('go', evidenceOf(s, path));
        const go = parseGoMod(content);
        if (go.goVersion) addRuntime(path, { value: { runtime: 'go', spec: go.goVersion.value }, line: go.goVersion.line, snippet: go.goVersion.snippet });
      } else if (name === 'Cargo.toml') {
        eco.add('rust');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('cargo', evidenceOf(s, path));
        const cargo = parseCargoToml(content);
        for (const d of cargo.dependencies) f.dependencies.push({ value: { name: d.value.name, ecosystem: 'rust', dev: d.value.dev }, evidence: evidenceOf(s, path, d.line, d.snippet) });
        if (cargo.rustVersion) addRuntime(path, { value: { runtime: 'rust', spec: cargo.rustVersion.value }, line: cargo.rustVersion.line, snippet: cargo.rustVersion.snippet });
      } else if (name === 'Gemfile') {
        eco.add('ruby');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('bundler', evidenceOf(s, path));
      } else if (name === 'composer.json') {
        eco.add('php');
        f.manifests.push({ value: path, evidence: evidenceOf(s, path) });
        addManager('composer', evidenceOf(s, path));
      } else if (['.nvmrc', '.node-version', '.python-version', 'runtime.txt', '.tool-versions', 'rust-toolchain', 'rust-toolchain.toml'].includes(name)) {
        for (const r of parseRuntimeFile(path, content)) addRuntime(path, r);
      } else if (name === 'Dockerfile' || /Dockerfile/.test(name)) {
        const d = parseDockerfile(content);
        for (const img of d.baseImages) {
          f.dockerBaseImages.push(located(s, path, img));
          const rt = runtimeFromImage(img.value);
          if (rt) addRuntime(path, { value: rt, line: img.line, snippet: img.snippet });
        }
      } else if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name)) {
        for (const svc of parseCompose(content)) f.composeServices.push(located(s, path, svc));
      } else if (name === 'Makefile') {
        for (const t of parseMakefile(content)) f.makeTargets.push(located(s, path, t));
      }

      if (isWorkflowPath(path)) {
        const wf = parseWorkflow(content);
        for (const c of wf.commands) f.ciCommands.push(located(s, path, c));
        for (const r of wf.runtimes) {
          f.ciRuntimes.push({ value: { runtime: r.value.runtime, spec: r.value.spec, minMajor: minVersion(r.value.spec).minMajor }, evidence: evidenceOf(s, path, r.line, r.snippet) });
        }
      }
      if (isEnvExamplePath(path)) {
        for (const e of parseEnvExample(content)) f.envExample.push(located(s, path, e));
      }
      if (isLicensePath(path)) {
        f.licenseName = licenseNameIn(content.slice(0, 1500).replace(/\s+/g, ' '));
      }
      if (isSourcePath(path)) {
        f.scannedSourceFiles++;
        for (const e of scanEnvUsage(content)) {
          if (!f.envInCode.some((x) => x.value === e.value)) f.envInCode.push(located(s, path, e));
        }
      }
    } catch {
      // A malformed file never breaks the whole check.
    }
  }

  f.ecosystems = [...eco];
  return f;
}
