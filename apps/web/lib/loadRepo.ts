import { RepoSnapshotResponseSchema, type GitHubErrorCode, type RepoSnapshot, type SourceInfo } from '@readme-intel/core';

export type RepoLoadResult = { ok: true; snapshot: RepoSnapshot; skipped: string[] } | { ok: false; code: GitHubErrorCode; resetAt: string | null };

/** Fetch the repository snapshot for a GitHub README through our proxy and validate it with Zod. */
export async function loadRepoSnapshot(source: Extract<SourceInfo, { kind: 'github' }>, signal?: AbortSignal): Promise<RepoLoadResult> {
  const params = new URLSearchParams({ owner: source.owner, repo: source.repo, ref: source.ref, path: source.path });
  let res: Response;
  try {
    res = await fetch(`/api/github/repo?${params.toString()}`, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { ok: false, code: 'NETWORK', resetAt: null };
  }
  try {
    const parsed = RepoSnapshotResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, code: 'UNKNOWN', resetAt: null };
    const data = parsed.data;
    return data.ok ? { ok: true, snapshot: data.snapshot, skipped: data.skipped } : { ok: false, code: data.error.code, resetAt: data.error.resetAt ?? null };
  } catch {
    return { ok: false, code: 'UNKNOWN', resetAt: null };
  }
}
