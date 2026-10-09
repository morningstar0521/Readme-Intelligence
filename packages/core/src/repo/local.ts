import { selectRepoFiles, type TreeEntry } from './select';
import type { RepoSnapshot } from './types';

/**
 * Build a RepoSnapshot from a file listing and a reader, without any network.
 * Used by the CLI / GitHub Action on a local checkout. Pure: the caller supplies the I/O,
 * so this stays usable in the browser bundle. Same file selection and limits as the
 * GitHub snapshot, so local and web results agree.
 */
export interface LocalSnapshotInput {
  owner: string;
  repo: string;
  ref: string;
  /** README path relative to the repository root, e.g. "README.md" or "docs/README.md". */
  readmePath: string;
  /** Every file in the repository (relative paths, "/" separators) with its size in bytes. */
  entries: TreeEntry[];
  /** Returns the file content, or null when it cannot be read. */
  readFile: (path: string) => string | null;
  maxTotalBytes?: number;
}

export function buildLocalSnapshot(input: LocalSnapshotInput): { snapshot: RepoSnapshot; skipped: string[] } {
  const maxTotal = input.maxTotalBytes ?? 3_000_000;
  const entries = input.entries.map((e) => ({ path: normalizePath(e.path), size: e.size })).filter((e) => e.path.length > 0);
  const readme = normalizePath(input.readmePath);
  const baseDir = readme.includes('/') ? readme.slice(0, readme.lastIndexOf('/')) : '';
  const wanted = selectRepoFiles(entries, baseDir);

  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  for (const path of wanted) {
    let text: string | null = null;
    try {
      text = input.readFile(path);
    } catch {
      text = null;
    }
    if (text === null || text.includes('\u0000') || total + text.length > maxTotal) {
      skipped.push(path);
      continue;
    }
    total += text.length;
    files[path] = text;
  }

  return {
    snapshot: { owner: input.owner, repo: input.repo, ref: input.ref, baseDir, tree: entries.map((e) => e.path).sort(), truncated: false, files },
    skipped: skipped.sort(),
  };
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
