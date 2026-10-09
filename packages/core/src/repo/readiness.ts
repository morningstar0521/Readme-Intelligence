import type { HealthCheck, HealthReport, Intelligence } from '../types';
import type { Claim, RepoFacts } from './types';
import { isPlaceholderTestScript } from './parsers';

/**
 * Setup Readiness score (0-100). Different question from the documentation health score:
 *   Documentation health: "Is the information present in the README?"
 *   Setup readiness:      "Does the repository back up the setup instructions, so a developer
 *                          can realistically get it running?"
 * Nothing is executed; this is a static consistency check between README and repository.
 * Weights sum to 100.
 */

export const READINESS_LABEL =
  'Static check of README against repository files. Nothing was installed or run, so a high score means "consistent", not "guaranteed to work".';

interface Rule {
  id: string;
  label: string;
  weight: number;
  suggestion: string;
  evaluate(intel: Intelligence, f: RepoFacts, claims: Claim[]): { passed: boolean; reason: string };
}

const contradictions = (claims: Claim[], ...categories: Claim['category'][]) => claims.filter((c) => c.status === 'contradiction' && categories.includes(c.category));
const hasCode = (f: RepoFacts) => f.manifests.length > 0 || f.ecosystems.length > 0;

export const READINESS_RULES: Rule[] = [
  {
    id: 'R01',
    label: 'Package manager detected',
    weight: 10,
    suggestion: 'Commit the lockfile or set "packageManager" in package.json so everyone uses the same tool.',
    evaluate: (_i, f) => {
      if (!hasCode(f)) return { passed: true, reason: 'No code manifests found: not applicable.' };
      return f.packageManagers.length > 0
        ? { passed: true, reason: `Detected ${f.packageManagers.map((p) => `${p.value} (${p.evidence.path})`).join(', ')}.` }
        : { passed: false, reason: 'No lockfile, packageManager field or tool configuration identifies the package manager.' };
    },
  },
  {
    id: 'R02',
    label: 'Runtime version stated',
    weight: 10,
    suggestion: 'Pin the runtime: "engines" in package.json, .nvmrc, requires-python or a .python-version file, and state it in Prerequisites.',
    evaluate: (intel, f) => {
      if (!hasCode(f)) return { passed: true, reason: 'No code manifests found: not applicable.' };
      if (f.runtimes.length > 0) return { passed: true, reason: `Repository states ${f.runtimes.map((r) => `${r.value.runtime} ${r.value.spec} (${r.evidence.path})`).slice(0, 3).join(', ')}.` };
      if (intel.prerequisites.some((p) => /\b(node|python|go|java|ruby|rust)\b[^\n]{0,15}\d/i.test(p.value))) return { passed: true, reason: 'README states a runtime version, but the repository does not pin it.' };
      return { passed: false, reason: 'Neither the README nor the repository states which runtime version is needed.' };
    },
  },
  {
    id: 'R03',
    label: 'Lockfile present',
    weight: 10,
    suggestion: 'Commit the lockfile (package-lock.json, pnpm-lock.yaml, poetry.lock, uv.lock, Cargo.lock...) so installs are reproducible.',
    evaluate: (_i, f) => {
      if (!hasCode(f)) return { passed: true, reason: 'No code manifests found: not applicable.' };
      if (f.lockfiles.length > 0) return { passed: true, reason: `Found ${f.lockfiles.map((l) => l.value).join(', ')}.` };
      const pinned = f.dependencies.filter((d) => d.value.ecosystem === 'python' && /==/.test(d.evidence.snippet));
      const python = f.dependencies.filter((d) => d.value.ecosystem === 'python');
      if (python.length > 0 && pinned.length / python.length >= 0.8) return { passed: true, reason: 'Python requirements are pinned with ==.' };
      return { passed: false, reason: 'No lockfile found, so every install can resolve different dependency versions.' };
    },
  },
  {
    id: 'R04',
    label: 'Install command valid',
    weight: 15,
    suggestion: 'Document the install command for the package manager the repository actually uses, and make sure every file it references exists.',
    evaluate: (intel, f, claims) => {
      const setup = intel.commands.filter((c) => c.category === 'setup');
      const bad = [...contradictions(claims, 'package-manager'), ...contradictions(claims, 'file').filter((c) => c.readme.some((r) => setup.some((s) => s.source.line === r.line)))];
      if (bad.length > 0) return { passed: false, reason: bad.map((b) => b.title).join('; ') };
      if (setup.length === 0) return hasCode(f) ? { passed: false, reason: 'The README has no install command.' } : { passed: true, reason: 'No code manifests found: not applicable.' };
      return { passed: true, reason: `${setup.length} install command(s), consistent with the repository.` };
    },
  },
  {
    id: 'R05',
    label: 'Run / dev command exists',
    weight: 15,
    suggestion: 'Document how to start the project, using a script or target that exists in the repository.',
    evaluate: (intel, f, claims) => {
      const broken = contradictions(claims, 'command');
      if (broken.length > 0) return { passed: false, reason: broken.map((b) => b.title).join('; ') };
      const run = intel.commands.filter((c) => c.category === 'dev');
      const repoRun = f.scripts.find((s) => /^(dev|start|serve|develop)$/.test(s.value.name));
      if (run.length > 0) return { passed: true, reason: `README run command: \`${run[0]!.command}\`.` };
      if (repoRun) return { passed: false, reason: `package.json has a "${repoRun.value.name}" script, but the README does not say how to run the project.` };
      return hasCode(f) ? { passed: false, reason: 'No run or dev command in the README.' } : { passed: true, reason: 'No code manifests found: not applicable.' };
    },
  },
  {
    id: 'R06',
    label: 'Test command exists',
    weight: 10,
    suggestion: 'Add a real test script (not the npm placeholder) or a pytest setup, and run it in CI.',
    evaluate: (_i, f) => {
      if (!hasCode(f)) return { passed: true, reason: 'No code manifests found: not applicable.' };
      const script = f.scripts.find((s) => /^test(:|$)/.test(s.value.name) && !isPlaceholderTestScript(s.value.command));
      if (script) return { passed: true, reason: `package.json "${script.value.name}": ${script.value.command}` };
      const pytest = f.dependencies.find((d) => d.value.ecosystem === 'python' && d.value.name === 'pytest');
      if (pytest) return { passed: true, reason: `pytest is a dependency (${pytest.evidence.path}).` };
      const ciTest = f.ciCommands.find((c) => /\b(test|pytest|go test|cargo test|jest|vitest|mvn (verify|test)|gradle test)\b/.test(c.value));
      if (ciTest) return { passed: true, reason: `CI runs \`${ciTest.value}\`.` };
      if (f.ecosystems.some((e) => e === 'go' || e === 'rust')) return { passed: true, reason: 'Go and Rust have a built-in test command.' };
      return { passed: false, reason: 'No test script, test framework dependency or CI test step found.' };
    },
  },
  {
    id: 'R07',
    label: 'Environment variables documented',
    weight: 10,
    suggestion: 'Document every variable the code reads or the example env file lists (name, purpose, required).',
    evaluate: (_i, _f, claims) => {
      const undocumented = claims.filter((c) => c.category === 'env' && c.status === 'repo-only');
      return undocumented.length === 0
        ? { passed: true, reason: 'Every environment variable found in the repository is documented.' }
        : { passed: false, reason: `${undocumented.length} undocumented: ${undocumented.slice(0, 5).map((c) => c.id.slice(4)).join(', ')}${undocumented.length > 5 ? '...' : ''}.` };
    },
  },
  {
    id: 'R08',
    label: '.env.example consistency',
    weight: 5,
    suggestion: 'Add a .env.example that lists every documented variable with a placeholder value.',
    evaluate: (intel, f) => {
      const needsEnv = intel.envVars.length > 0 || f.envInCode.length > 0;
      if (!needsEnv) return { passed: true, reason: 'No environment variables used: not applicable.' };
      if (f.envExample.length === 0) return { passed: false, reason: 'Environment variables are used but there is no example env file.' };
      const inExample = new Set(f.envExample.map((e) => e.value));
      const missing = intel.envVars.filter((e) => !inExample.has(e.name)).map((e) => e.name);
      return missing.length === 0
        ? { passed: true, reason: `${f.envExample[0]!.evidence.path} lists every documented variable.` }
        : { passed: false, reason: `Documented but missing from ${f.envExample[0]!.evidence.path}: ${missing.slice(0, 5).join(', ')}.` };
    },
  },
  {
    id: 'R09',
    label: 'Docker setup consistent',
    weight: 5,
    suggestion: 'Make the README Docker commands match the Dockerfile / Compose files in the repository.',
    evaluate: (_i, f, claims) => {
      const bad = contradictions(claims, 'docker');
      if (bad.length > 0) return { passed: false, reason: bad.map((b) => b.title).join('; ') };
      if (f.dockerfiles.length === 0 && f.composeFiles.length === 0) return { passed: true, reason: 'No Docker setup: not applicable.' };
      return { passed: true, reason: 'Docker files and README instructions agree.' };
    },
  },
  {
    id: 'R10',
    label: 'CI consistent with README',
    weight: 10,
    suggestion: 'Add a CI workflow that installs and tests the project with the same commands the README documents.',
    evaluate: (intel, f) => {
      if (f.workflows.length === 0) return { passed: false, reason: 'No CI workflow found, so nothing checks that the documented setup still works.' };
      const readmePm = intel.commands.map((c) => c.command.split(/\s+/)[0]!).find((t) => ['npm', 'pnpm', 'yarn', 'bun'].includes(t));
      const ciPm = f.ciCommands.map((c) => c.value.split(/\s+/)[0]!).find((t) => ['npm', 'pnpm', 'yarn', 'bun'].includes(t));
      if (readmePm && ciPm && readmePm !== ciPm) return { passed: false, reason: `README uses ${readmePm}, CI uses ${ciPm}.` };
      return { passed: true, reason: `${f.workflows.length} workflow(s)${ciPm ? `, using ${ciPm}` : ''}.` };
    },
  },
];

export const READINESS_TOTAL_WEIGHT = READINESS_RULES.reduce((s, r) => s + r.weight, 0);

export function computeReadiness(intel: Intelligence, facts: RepoFacts, claims: Claim[]): HealthReport {
  const checks: HealthCheck[] = READINESS_RULES.map((rule) => {
    let passed = false;
    let reason = 'Check could not be evaluated.';
    try {
      ({ passed, reason } = rule.evaluate(intel, facts, claims));
    } catch {
      /* reported as failed */
    }
    return { id: rule.id, label: rule.label, weight: rule.weight, passed, reason, suggestion: passed ? null : rule.suggestion };
  });
  return { score: checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0), checks };
}
