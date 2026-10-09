import { NextResponse, type NextRequest } from 'next/server';
import { LruCache, errorMessage, fetchRepoSnapshot, validRepoTarget, type FetchRepoResult, type GitHubErrorCode } from '@readme-intel/core';

/**
 * GET /api/github/repo?owner=&repo=&ref=&path=
 * Read-only repository snapshot for the Reality Check: the Git tree plus up to 60 small files
 * (manifests, lockfile presence, Docker, workflows, .env.example, LICENSE, a sample of source files).
 * Same SSRF allow-list as the README proxy; GITHUB_TOKEN stays on the server.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Success = Extract<FetchRepoResult, { ok: true }>;
const cache = new LruCache<string, Success>(30, 10 * 60 * 1000);

const STATUS: Record<GitHubErrorCode, number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_OR_FORBIDDEN: 403,
  RATE_LIMITED: 429,
  TOO_LARGE: 413,
  NETWORK: 502,
  UNKNOWN: 502,
};

function error(code: GitHubErrorCode, resetAt: string | null = null) {
  return NextResponse.json({ ok: false, error: { code, message: errorMessage(code, resetAt), resetAt } }, { status: STATUS[code], headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const owner = q.get('owner') ?? '';
  const repo = q.get('repo') ?? '';
  const ref = q.get('ref') ?? 'HEAD';
  const readmePath = q.get('path') ?? 'README.md';
  if (!validRepoTarget(owner, repo, ref, readmePath)) return error('INVALID_URL');

  const key = `${owner}/${repo}`.toLowerCase() + `@${ref}:${readmePath}`;
  const cached = cache.get(key);
  const result = cached ?? (await fetchRepoSnapshot({ owner, repo, ref, readmePath }, { token: process.env.GITHUB_TOKEN || undefined }));
  if (!result.ok) return error(result.error.code, result.error.resetAt);
  if (!cached) cache.set(key, result);

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600', 'X-Cache': cached ? 'HIT' : 'MISS' },
  });
}
