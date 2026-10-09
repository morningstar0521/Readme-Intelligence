import { z } from 'zod';
import type { GitHubErrorCode } from '../types';
import type { RepoSnapshot } from './types';
import { selectRepoFiles, type TreeEntry } from './select';
import { fail, isRateLimited, rateLimitReset, timedFetch, type FetchLike } from '../github/fetchReadme';
import { encodePath } from '../github/rawBase';
import { readmeDir } from '../render/resolveUrls';
import { GitHubErrorCodeSchema } from '../schemas';

/**
 * Fetch a read-only repository snapshot for the Reality Check:
 *   1 call  GET api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1
 *   N calls GET raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}   (N <= 60, 6 at a time)
 * Owner, repo and ref are validated before any request (same SSRF allow-list as the README fetch).
 */

export interface FetchRepoOptions {
  fetchImpl?: FetchLike;
  token?: string;
  timeoutMs?: number;
  concurrency?: number;
  /** Total content budget; files beyond it are skipped. */
  maxTotalBytes?: number;
}

export type FetchRepoResult =
  | { ok: true; snapshot: RepoSnapshot; skipped: string[] }
  | { ok: false; error: { code: GitHubErrorCode; message: string; resetAt: string | null } };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,255}$/;
const PATH_RE = /^[^\0\\]*$/;

const TreeSchema = z.object({
  truncated: z.boolean().optional().default(false),
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional() })),
});

export const RepoSnapshotSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string(),
  baseDir: z.string(),
  tree: z.array(z.string()),
  truncated: z.boolean(),
  files: z.record(z.string()),
});

export const RepoSnapshotResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: RepoSnapshotSchema, skipped: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.object({ code: GitHubErrorCodeSchema, message: z.string(), resetAt: z.string().nullable().optional() }) }),
]);

export function validRepoTarget(owner: string, repo: string, ref: string, readmePath: string): boolean {
  return OWNER_RE.test(owner) && REPO_RE.test(repo) && repo !== '.' && repo !== '..' && REF_RE.test(ref) && !ref.split('/').includes('..') && PATH_RE.test(readmePath) && !readmePath.split('/').includes('..');
}

export async function fetchRepoSnapshot(
  target: { owner: string; repo: string; ref: string; readmePath: string },
  options: FetchRepoOptions = {}
): Promise<FetchRepoResult> {
  const { owner, repo, ref, readmePath } = target;
  if (!validRepoTarget(owner, repo, ref, readmePath)) return fail('INVALID_URL');
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const concurrency = options.concurrency ?? 6;
  const maxTotal = options.maxTotalBytes ?? 3_000_000;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'readme-intelligence-viewer',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let res: Response;
  try {
    res = await timedFetch(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodePath(ref)}?recursive=1`, { headers }, timeoutMs);
  } catch {
    return fail('NETWORK');
  }
  if (res.status === 404 || res.status === 422) return fail('NOT_FOUND');
  if (isRateLimited(res)) return fail('RATE_LIMITED', rateLimitReset(res));
  if (res.status === 401 || res.status === 403) return fail('PRIVATE_OR_FORBIDDEN');
  if (!res.ok) return fail('UNKNOWN');

  let parsed: z.infer<typeof TreeSchema>;
  try {
    const json = TreeSchema.safeParse(await res.json());
    if (!json.success) return fail('UNKNOWN');
    parsed = json.data;
  } catch {
    return fail('UNKNOWN');
  }

  const entries: TreeEntry[] = parsed.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size }));
  const baseDir = readmeDir(readmePath);
  const wanted = selectRepoFiles(entries, baseDir);

  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  let index = 0;
  const worker = async () => {
    while (index < wanted.length) {
      const path = wanted[index++]!;
      try {
        const r = await timedFetch(fetchImpl, `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(ref)}/${encodePath(path)}`, { headers: { 'User-Agent': 'readme-intelligence-viewer' } }, timeoutMs);
        if (!r.ok) {
          skipped.push(path);
          continue;
        }
        const text = await r.text();
        if (total + text.length > maxTotal || text.includes('\u0000')) {
          skipped.push(path);
          continue;
        }
        total += text.length;
        files[path] = text;
      } catch {
        skipped.push(path);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));

  // Deterministic key order regardless of network timing.
  const ordered: Record<string, string> = {};
  for (const p of wanted) if (p in files) ordered[p] = files[p]!;

  return {
    ok: true,
    snapshot: { owner, repo, ref, baseDir, tree: entries.map((e) => e.path), truncated: parsed.truncated, files: ordered },
    skipped: skipped.sort(),
  };
}
