import { GitHubReadmeResponseSchema, type GitHubErrorCode, type SourceInfo } from '@readme-intel/core';

export type LoadResult =
  | { ok: true; markdown: string; source: SourceInfo }
  | { ok: false; code: GitHubErrorCode; resetAt: string | null };

/** Fetch a GitHub README through our proxy route and validate the response with Zod. */
export async function loadGitHubReadme(input: string, signal?: AbortSignal): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch(`/api/github/readme?url=${encodeURIComponent(input)}`, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { ok: false, code: 'NETWORK', resetAt: null };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, code: 'UNKNOWN', resetAt: null };
  }
  const parsed = GitHubReadmeResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, code: 'UNKNOWN', resetAt: null };
  const data = parsed.data;
  if (data.ok) return { ok: true, markdown: data.markdown, source: data.source as SourceInfo };
  return { ok: false, code: data.error.code, resetAt: data.error.resetAt ?? null };
}
