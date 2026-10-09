/**
 * pnpm fixtures:fetch [--force] [--only owner/repo] [--with-repo]
 * Downloads the READMEs listed in scripts/fixture-repos.json into
 * packages/core/tests/fixtures/readmes/<owner>__<repo>.md and records them in
 * packages/core/tests/fixtures/index.json. Uses GITHUB_TOKEN when set (higher rate limit).
 * Existing files are kept unless --force is passed, so labels stay in sync with their README.
 * --with-repo also saves a repository snapshot (Git tree + up to 60 small files) for the
 * Reality Check eval to packages/core/tests/fixtures/repos/<owner>__<repo>.json, pinned to
 * the same ref as the README.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGitHubReadme, fetchRepoSnapshot } from '../packages/core/src/index';

interface RepoEntry {
  repo: string;
  category: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'packages/core/tests/fixtures');
const readmeDir = path.join(fixtureDir, 'readmes');
const repoDir = path.join(fixtureDir, 'repos');
const indexPath = path.join(fixtureDir, 'index.json');
const list: RepoEntry[] = JSON.parse(readFileSync(path.join(root, 'scripts/fixture-repos.json'), 'utf8'));

const force = process.argv.includes('--force');
const withRepo = process.argv.includes('--with-repo');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

mkdirSync(readmeDir, { recursive: true });
if (withRepo) mkdirSync(repoDir, { recursive: true });
type IndexEntry = { name: string; repo: string; url: string; ref?: string; path?: string; category?: string; fetchedAt?: string };
const index: IndexEntry[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
const byName = new Map(index.map((e) => [e.name, e]));

let fetched = 0;
let skipped = 0;
let failed = 0;
let snapshots = 0;

/** Save the repository snapshot next to the README. Returns false when rate limited (stop the run). */
async function saveSnapshot(name: string, repoFull: string, ref: string, readmePath: string): Promise<boolean> {
  const file = path.join(repoDir, `${name}.json`);
  if (existsSync(file) && !force) return true;
  const [owner, repo] = repoFull.split('/') as [string, string];
  const snap = await fetchRepoSnapshot({ owner, repo, ref, readmePath }, { token: process.env.GITHUB_TOKEN });
  if (!snap.ok) {
    console.error(`x ${repoFull} snapshot: ${snap.error.code} ${snap.error.message}`);
    return snap.error.code !== 'RATE_LIMITED';
  }
  writeFileSync(file, JSON.stringify(snap.snapshot, null, 2) + '\n');
  snapshots++;
  console.log(`ok ${repoFull} snapshot (${Object.keys(snap.snapshot.files).length} files of ${snap.snapshot.tree.length}${snap.skipped.length ? `, ${snap.skipped.length} skipped` : ''})`);
  return true;
}

for (const entry of list) {
  if (only && entry.repo.toLowerCase() !== only.toLowerCase()) continue;
  const name = entry.repo.replace('/', '__');
  const file = path.join(readmeDir, `${name}.md`);
  if (existsSync(file) && !force) {
    skipped++;
    const existing = byName.get(name);
    if (withRepo && !(await saveSnapshot(name, entry.repo, existing?.ref ?? 'HEAD', existing?.path ?? 'README.md'))) {
      console.error('Rate limited. Set GITHUB_TOKEN and run again.');
      break;
    }
    continue;
  }
  const result = await fetchGitHubReadme(entry.repo, { token: process.env.GITHUB_TOKEN });
  if (!result.ok) {
    console.error(`x ${entry.repo}: ${result.error.code} ${result.error.message}`);
    failed++;
    if (result.error.code === 'RATE_LIMITED') {
      console.error('Rate limited. Set GITHUB_TOKEN and run again.');
      break;
    }
    continue;
  }
  writeFileSync(file, result.markdown);
  const src = result.source;
  byName.set(name, {
    name,
    repo: entry.repo,
    url: `https://github.com/${entry.repo}`,
    ref: src.kind === 'github' ? src.ref : undefined,
    path: src.kind === 'github' ? src.path : undefined,
    category: entry.category,
    fetchedAt: new Date().toISOString(),
  });
  fetched++;
  console.log(`ok ${entry.repo} (${result.markdown.length} chars)`);
  if (withRepo && src.kind === 'github' && !(await saveSnapshot(name, entry.repo, src.ref, src.path))) {
    console.error('Rate limited. Set GITHUB_TOKEN and run again.');
    break;
  }
}

writeFileSync(indexPath, JSON.stringify([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n');
console.log(`\nFetched ${fetched}, kept ${skipped} existing, failed ${failed}${withRepo ? `, saved ${snapshots} repo snapshots` : ''}. Index: ${path.relative(root, indexPath)}`);
console.log('Next: pnpm fixtures:labels, then label each JSON file by hand (docs/LABELING.md).');
