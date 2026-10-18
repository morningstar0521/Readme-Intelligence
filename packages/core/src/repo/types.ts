import type { HealthReport, SourceRef } from '../types';

/**
 * Repository Reality Check types.
 * A snapshot is a deterministic, read-only view of a few repository files.
 * Facts are parsed from the snapshot. Claims compare README statements with facts.
 */

export interface RepoSnapshot {
  owner: string;
  repo: string;
  /** Branch, tag or commit used for every file. */
  ref: string;
  /** Directory of the README inside the repo ("" for root). Manifests are looked up here first. */
  baseDir: string;
  /** Every blob path in the repository tree (from the Git trees API). */
  tree: string[];
  /** True when GitHub truncated the tree listing; "file missing" checks are then skipped. */
  truncated: boolean;
  /** Contents of the selected files, keyed by repo path. */
  files: Record<string, string>;
}

export type RepoEvidence =
  | { kind: 'content'; path: string; line: number; snippet: string }
  | { kind: 'tree-absence'; path: string; treeTruncated: boolean };

export type Ecosystem = 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'php' | 'java' | 'dotnet';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'uv' | 'pipenv' | 'conda' | 'go' | 'cargo' | 'bundler' | 'composer' | 'maven' | 'gradle';

export interface Located<T> {
  value: T;
  evidence: RepoEvidence;
}

export interface RepoFacts {
  /** Manifest files found (package.json, pyproject.toml...). */
  manifests: Located<string>[];
  /** Nested package.json files (monorepo packages). They add dependencies only: never scripts, engines or package manager. */
  workspaceManifests: Located<string>[];
  ecosystems: Ecosystem[];
  /** Package managers proven by lockfiles or package.json "packageManager". */
  packageManagers: Located<PackageManager>[];
  lockfiles: Located<string>[];
  /** npm scripts: name -> command. */
  scripts: Located<{ name: string; command: string }>[];
  /** The scripts object, used as explicit evidence when a README script is absent. */
  scriptSections: Located<string>[];
  dependencies: Located<{ name: string; ecosystem: Ecosystem; dev: boolean }>[];
  /** Runtime version requirements (engines, .nvmrc, requires-python, go directive...). */
  runtimes: Located<{ runtime: 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'java'; spec: string; minMajor: number | null; minMinor: number | null }>[];
  envExample: Located<string>[];
  envInCode: Located<string>[];
  dockerfiles: Located<string>[];
  dockerBaseImages: Located<string>[];
  composeFiles: Located<string>[];
  composeServices: Located<{ name: string; image: string | null }>[];
  workflows: Located<string>[];
  ciCommands: Located<string>[];
  ciRuntimes: Located<{ runtime: 'node' | 'python' | 'go' | 'java'; spec: string; minMajor: number | null }>[];
  makeTargets: Located<string>[];
  licenseFile: Located<string> | null;
  /** License name read from the LICENSE file (MIT, Apache-2.0...). */
  licenseName: string | null;
  contributingFile: Located<string> | null;
  /** True when the env-usage scan covered source files (otherwise "README-only" env vars stay unverified). */
  scannedSourceFiles: number;
}

export type ClaimStatus = 'verified' | 'contradiction' | 'readme-only' | 'repo-only' | 'unverified';

export type ClaimCategory =
  | 'command'
  | 'package-manager'
  | 'runtime'
  | 'env'
  | 'tech'
  | 'docker'
  | 'ci'
  | 'license'
  | 'contributing'
  | 'file'
  | 'link';

export interface Claim {
  /** Stable id used by the evaluator, e.g. "script:dev", "env:DATABASE_URL", "link:docs/a.md". */
  id: string;
  category: ClaimCategory;
  status: ClaimStatus;
  title: string;
  detail: string;
  readme: SourceRef[];
  repo: RepoEvidence[];
}

export interface RealityReport {
  snapshot: { owner: string; repo: string; ref: string; baseDir: string; truncated: boolean; fileCount: number; treeSize: number };
  claims: Claim[];
  counts: Record<ClaimStatus, number>;
  readiness: HealthReport;
  facts: RepoFacts;
}
