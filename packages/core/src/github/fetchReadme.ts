import { z } from 'zod';
import type { GitHubErrorCode, SourceInfo } from '../types';
import { parseGitHubInput, type GitHubTarget } from './parseUrl';
import { buildGitHubSource, encodePath } from './rawBase';
import { errorMessage } from '../errors';
import { utf8ByteLength } from '../util/text';
import { MAX_INPUT_BYTES } from '../parse/parseMarkdown';

/**
 * Fetch a README from GitHub (Technical design 3.4).
 *
 * - Only api.github.com and raw.githubusercontent.com are ever called, with URLs built
 *   from validated owner/repo/ref/path parts (no user-controlled host => no SSRF).
 * - Uses GET /repos/{owner}/{repo}/readme[/{dir}]?ref=... with the JSON media type so the
 *   response also carries the README path and resolved ref (needed to resolve relative URLs).
 *   (Documented deviation: the PRD mentions the raw media type; JSON gives the same content
 *   plus metadata in a single request.)
 * - Falls back to raw.githubusercontent.com/{owner}/{repo}/{ref|HEAD}/README.md on 404 or rate limit.
 * - `fetchImpl` and `token` are injected; the token is only ever used server-side.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchReadmeOptions {
  fetchImpl?: FetchLike;
  token?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchReadmeResult =
  | { ok: true; markdown: string; source: SourceInfo }
  | { ok: false; error: { code: GitHubErrorCode; message: string; resetAt: string | null } };

const ReadmeApiSchema = z.object({
  path: z.string(),
  size: z.number(),
  content: z.string().optional().default(''),
  encoding: z.string().optional().default('base64'),
  download_url: z.string().nullable().optional(),
});

export function fail(code: GitHubErrorCode, resetAt: string | null = null): Extract<FetchReadmeResult, { ok: false }> {
  return { ok: false, error: { code, message: errorMessage(code, resetAt), resetAt } };
}

/** Decode base64 into a UTF-8 string without Node's Buffer (works in browsers and edge runtimes). */
export function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Extract the ref from a raw download URL: https://raw.githubusercontent.com/o/r/{ref}/{path} */
export function refFromDownloadUrl(downloadUrl: string, owner: string, repo: string, path: string): string | null {
  try {
    const url = new URL(downloadUrl);
    if (url.hostname !== 'raw.githubusercontent.com') return null;
    const prefix = `/${owner}/${repo}/`.toLowerCase();
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.toLowerCase().startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    const suffix = `/${path}`;
    if (!rest.endsWith(suffix)) return null;
    const ref = rest.slice(0, rest.length - suffix.length);
    return ref || null;
  } catch {
    return null;
  }
}

export function rateLimitReset(res: Response): string | null {
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) return new Date(Number(reset) * 1000).toISOString();
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
  return null;
}

export function isRateLimited(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
}

export async function timedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const host = new URL(url).hostname;
  if (host !== 'api.github.com' && host !== 'raw.githubusercontent.com') {
    // Defence in depth: should be impossible because URLs are built from validated parts.
    throw new Error('Host not allowed');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(res: Response, maxBytes: number): Promise<string | 'TOO_LARGE'> {
  const declared = res.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) return 'TOO_LARGE';
  const text = await res.text();
  if (utf8ByteLength(text) > maxBytes) return 'TOO_LARGE';
  return text;
}

async function fetchRaw(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  timeoutMs: number,
  maxBytes: number
): Promise<FetchReadmeResult> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(ref)}/${encodePath(path)}`;
  let res: Response;
  try {
    res = await timedFetch(fetchImpl, url, { headers: { 'User-Agent': 'readme-intelligence-viewer' } }, timeoutMs);
  } catch {
    return fail('NETWORK');
  }
  if (res.status === 404) return fail('NOT_FOUND');
  if (isRateLimited(res)) return fail('RATE_LIMITED', rateLimitReset(res));
  if (res.status === 401 || res.status === 403) return fail('PRIVATE_OR_FORBIDDEN');
  if (!res.ok) return fail('UNKNOWN');
  const text = await readLimitedText(res, maxBytes);
  if (text === 'TOO_LARGE') return fail('TOO_LARGE');
  // "HEAD" is not a useful ref for links, but it works with raw.githubusercontent.com and github.com/blob.
  return { ok: true, markdown: text, source: buildGitHubSource(owner, repo, ref, path) };
}

async function fetchRepoReadme(
  target: Extract<GitHubTarget, { kind: 'repo' }>,
  fetchImpl: FetchLike,
  token: string | undefined,
  timeoutMs: number,
  maxBytes: number
): Promise<FetchReadmeResult> {
  const { owner, repo, ref, dir } = target;
  const dirPart = dir ? `/${encodePath(dir)}` : '';
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/readme${dirPart}${query}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'readme-intelligence-viewer',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const fallbackPath = dir ? `${dir.replace(/\/+$/, '')}/README.md` : 'README.md';
  const fallback = () => fetchRaw(fetchImpl, owner, repo, ref ?? 'HEAD', fallbackPath, timeoutMs, maxBytes);

  let res: Response;
  try {
    res = await timedFetch(fetchImpl, url, { headers }, timeoutMs);
  } catch {
    return fail('NETWORK');
  }

  if (res.status === 404) {
    const fb = await fallback();
    return fb.ok ? fb : fail('NOT_FOUND');
  }
  if (isRateLimited(res)) {
    const resetAt = rateLimitReset(res);
    const fb = await fallback();
    return fb.ok ? fb : fail('RATE_LIMITED', resetAt);
  }
  if (res.status === 401 || res.status === 403) return fail('PRIVATE_OR_FORBIDDEN');
  if (!res.ok) return fail('UNKNOWN');

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return fail('UNKNOWN');
  }
  const parsed = ReadmeApiSchema.safeParse(json);
  if (!parsed.success) return fail('UNKNOWN');
  const data = parsed.data;

  if (data.size > maxBytes) return fail('TOO_LARGE');
  if (data.encoding !== 'base64' || (data.content === '' && data.size > 0)) {
    // GitHub omits content for very large files.
    return fail('TOO_LARGE');
  }

  let markdown: string;
  try {
    markdown = decodeBase64Utf8(data.content);
  } catch {
    return fail('UNKNOWN');
  }
  if (utf8ByteLength(markdown) > maxBytes) return fail('TOO_LARGE');

  const resolvedRef =
    (data.download_url ? refFromDownloadUrl(data.download_url, owner, repo, data.path) : null) ?? ref ?? 'HEAD';

  return { ok: true, markdown, source: buildGitHubSource(owner, repo, resolvedRef, data.path) };
}

/** Fetch a README for any accepted GitHub input. Never throws. */
export async function fetchGitHubReadme(input: string, options: FetchReadmeOptions = {}): Promise<FetchReadmeResult> {
  const parsed = parseGitHubInput(input);
  if (!parsed.ok) return fail('INVALID_URL');

  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? MAX_INPUT_BYTES;

  try {
    const target = parsed.target;
    if (target.kind === 'file') {
      return await fetchRaw(fetchImpl, target.owner, target.repo, target.ref, target.path, timeoutMs, maxBytes);
    }
    return await fetchRepoReadme(target, fetchImpl, options.token, timeoutMs, maxBytes);
  } catch {
    return fail('UNKNOWN');
  }
}

/** Stable cache key for an input (same repo in different spellings shares a key). */
export function cacheKeyFor(input: string): string | null {
  const parsed = parseGitHubInput(input);
  if (!parsed.ok) return null;
  const t = parsed.target;
  // Owner and repo names are case-insensitive on GitHub; refs and paths are not.
  const repoKey = `${t.owner}/${t.repo}`.toLowerCase();
  return t.kind === 'file' ? `file:${repoKey}@${t.ref}:${t.path}` : `repo:${repoKey}@${t.ref ?? ''}:${t.dir}`;
}
