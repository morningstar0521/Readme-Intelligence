import { NextResponse, type NextRequest } from 'next/server';
import {
  LruCache,
  cacheKeyFor,
  errorMessage,
  fetchGitHubReadme,
  type FetchReadmeResult,
  type GitHubErrorCode,
  type GitHubReadmeResponse,
} from '@readme-intel/core';

/**
 * GET /api/github/readme?url=<encoded>
 * Server-side proxy for GitHub README fetches (Technical design 3.4):
 * - only github.com / raw.githubusercontent.com input, only api.github.com / raw.githubusercontent.com calls (SSRF allow-list)
 * - optional GITHUB_TOKEN (server only, never sent to the client)
 * - in-memory LRU cache: 50 entries, 10 minutes
 * - typed errors with the exact UI copy, never a stack trace
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Success = Extract<FetchReadmeResult, { ok: true }>;

const TTL_MS = 10 * 60 * 1000;
const cache = new LruCache<string, Success>(50, TTL_MS);

const STATUS: Record<GitHubErrorCode, number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_OR_FORBIDDEN: 403,
  RATE_LIMITED: 429,
  TOO_LARGE: 413,
  NETWORK: 502,
  UNKNOWN: 502,
};

function errorResponse(code: GitHubErrorCode, resetAt: string | null = null) {
  const body: GitHubReadmeResponse = { ok: false, error: { code, message: errorMessage(code, resetAt), resetAt } };
  return NextResponse.json(body, { status: STATUS[code], headers: { 'Cache-Control': 'no-store' } });
}

function successResponse(result: Success, cacheStatus: 'HIT' | 'MISS') {
  const body: GitHubReadmeResponse = { ok: true, markdown: result.markdown, source: result.source };
  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=60',
      'X-Cache': cacheStatus,
    },
  });
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('url') ?? '';
  const key = cacheKeyFor(input);
  if (!key) return errorResponse('INVALID_URL');

  const cached = cache.get(key);
  if (cached) return successResponse(cached, 'HIT');

  const result = await fetchGitHubReadme(input, { token: process.env.GITHUB_TOKEN || undefined });
  if (!result.ok) return errorResponse(result.error.code, result.error.resetAt);

  cache.set(key, result);
  return successResponse(result, 'MISS');
}
