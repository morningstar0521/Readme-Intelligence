import type { SourceInfo } from '../types';
import { readmeDir } from '../render/resolveUrls';

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Base URL used to resolve relative images, e.g.
 * computeRawBase("owner", "repo", "main", "docs/README.md") ->
 * "https://raw.githubusercontent.com/owner/repo/main/docs/"
 */
export function computeRawBase(owner: string, repo: string, ref: string, readmePath: string): string {
  const dir = readmeDir(readmePath);
  const refPart = encodePath(ref);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${refPart}/${dir ? `${encodePath(dir)}/` : ''}`;
}

/** Build the SourceInfo for a README fetched from GitHub. */
export function buildGitHubSource(
  owner: string,
  repo: string,
  ref: string,
  readmePath: string
): Extract<SourceInfo, { kind: 'github' }> {
  const path = readmePath.replace(/^\/+/, '');
  return {
    kind: 'github',
    owner,
    repo,
    ref,
    path,
    rawBase: computeRawBase(owner, repo, ref, path),
    htmlUrl: `https://github.com/${owner}/${repo}/blob/${encodePath(ref)}/${encodePath(path)}`,
  };
}

export { encodePath };
