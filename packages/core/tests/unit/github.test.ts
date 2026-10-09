import { describe, it, expect } from 'vitest';
import { parseGitHubInput } from '../../src/github/parseUrl';
import { computeRawBase, buildGitHubSource } from '../../src/github/rawBase';
import { fetchGitHubReadme, refFromDownloadUrl, decodeBase64Utf8, cacheKeyFor, type FetchLike } from '../../src/github/fetchReadme';
import { LruCache } from '../../src/util/lru';

describe('parseGitHubInput', () => {
  const ok = (input: string) => {
    const r = parseGitHubInput(input);
    if (!r.ok) throw new Error(`expected ok for ${input}`);
    return r.target;
  };

  it('repo URL', () => {
    expect(ok('https://github.com/vercel/next.js')).toEqual({ kind: 'repo', owner: 'vercel', repo: 'next.js', ref: null, dir: '' });
  });

  it('trailing slash, .git suffix, www, query and hash', () => {
    expect(ok('https://github.com/acme/app/')).toMatchObject({ owner: 'acme', repo: 'app' });
    expect(ok('https://github.com/acme/app.git')).toMatchObject({ repo: 'app' });
    expect(ok('https://www.github.com/acme/app')).toMatchObject({ repo: 'app' });
    expect(ok('https://github.com/acme/app?tab=readme-ov-file#readme')).toMatchObject({ repo: 'app', ref: null });
  });

  it('no scheme and http', () => {
    expect(ok('github.com/acme/app')).toMatchObject({ owner: 'acme', repo: 'app' });
    expect(ok('http://github.com/acme/app')).toMatchObject({ owner: 'acme', repo: 'app' });
  });

  it('owner/repo shorthand', () => {
    expect(ok('acme/app')).toEqual({ kind: 'repo', owner: 'acme', repo: 'app', ref: null, dir: '' });
  });

  it('/tree/branch/path', () => {
    expect(ok('https://github.com/acme/app/tree/dev/packages/web')).toEqual({ kind: 'repo', owner: 'acme', repo: 'app', ref: 'dev', dir: 'packages/web' });
    expect(ok('https://github.com/acme/app/tree/main')).toMatchObject({ ref: 'main', dir: '' });
  });

  it('/blob/ref/path', () => {
    expect(ok('https://github.com/acme/app/blob/main/docs/README.md')).toEqual({ kind: 'file', owner: 'acme', repo: 'app', ref: 'main', path: 'docs/README.md' });
  });

  it('raw.githubusercontent.com URLs, including refs/heads form', () => {
    expect(ok('https://raw.githubusercontent.com/acme/app/main/README.md')).toEqual({ kind: 'file', owner: 'acme', repo: 'app', ref: 'main', path: 'README.md' });
    expect(ok('https://raw.githubusercontent.com/acme/app/refs/heads/dev/docs/x.md')).toEqual({ kind: 'file', owner: 'acme', repo: 'app', ref: 'dev', path: 'docs/x.md' });
  });

  it('other repo sub pages fall back to the root README', () => {
    expect(ok('https://github.com/acme/app/issues/12')).toMatchObject({ kind: 'repo', ref: null, dir: '' });
  });

  it('rejects invalid hosts, IPs and localhost (SSRF allow-list)', () => {
    for (const bad of [
      'https://gitlab.com/acme/app',
      'https://evil.com/acme/app',
      'https://github.com.evil.com/acme/app',
      'https://127.0.0.1/acme/app',
      'http://localhost:3000/acme/app',
      'https://api.github.com/repos/acme/app',
      'https://gist.github.com/acme/abc',
      'https://user:pass@github.com/acme/app',
      'https://github.com:8443/acme/app',
      'ftp://github.com/acme/app',
      'javascript:alert(1)',
    ]) {
      expect(parseGitHubInput(bad).ok).toBe(false);
    }
  });

  it('rejects user pages, reserved paths and malformed names', () => {
    for (const bad of ['https://github.com/acme', 'https://github.com/settings/profile', 'https://github.com/orgs/acme', 'https://github.com/-bad/app', 'https://github.com/acme/..', '', '   ', 'not a url', 'https://github.com/acme/app/blob/main']) {
      expect(parseGitHubInput(bad).ok).toBe(false);
    }
  });

  it('rejects path traversal and encoded control characters', () => {
    expect(parseGitHubInput('https://github.com/acme/app/blob/main/../../x').ok).toBe(false);
    expect(parseGitHubInput('https://github.com/acme/app/blob/main/a%00b.md').ok).toBe(false);
  });

  it('returns the exact invalid URL copy', () => {
    const r = parseGitHubInput('https://example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('That does not look like a GitHub repository or README link.');
  });
});

describe('rawBase', () => {
  it('computeRawBase uses the README directory', () => {
    expect(computeRawBase('o', 'r', 'main', 'README.md')).toBe('https://raw.githubusercontent.com/o/r/main/');
    expect(computeRawBase('o', 'r', 'main', 'docs/README.md')).toBe('https://raw.githubusercontent.com/o/r/main/docs/');
  });

  it('buildGitHubSource', () => {
    const s = buildGitHubSource('o', 'r', 'v1.0', '/docs/README.md');
    expect(s).toMatchObject({ kind: 'github', owner: 'o', repo: 'r', ref: 'v1.0', path: 'docs/README.md', rawBase: 'https://raw.githubusercontent.com/o/r/v1.0/docs/' });
    expect(s.htmlUrl).toBe('https://github.com/o/r/blob/v1.0/docs/README.md');
  });
});

/** Build a fake fetch that answers by URL prefix. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>, calls: string[] = []): FetchLike {
  return async (url: string) => {
    calls.push(url);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return handler();
    }
    return new Response('not found', { status: 404 });
  };
}

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('fetchGitHubReadme', () => {
  it('fetches the README through the API and resolves ref and path', async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(
      {
        'https://api.github.com/repos/acme/app/readme': () =>
          Response.json({ path: 'README.md', size: 10, content: b64('# Héllo'), encoding: 'base64', download_url: 'https://raw.githubusercontent.com/acme/app/main/README.md' }),
      },
      calls
    );
    const r = await fetchGitHubReadme('https://github.com/acme/app', { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markdown).toBe('# Héllo');
      expect(r.source).toMatchObject({ kind: 'github', owner: 'acme', repo: 'app', ref: 'main', path: 'README.md' });
    }
    expect(calls[0]).toBe('https://api.github.com/repos/acme/app/readme');
  });

  it('passes ref and directory for /tree URLs', async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(
      { 'https://api.github.com/': () => Response.json({ path: 'pkg/README.md', size: 3, content: b64('# x'), encoding: 'base64', download_url: 'https://raw.githubusercontent.com/acme/app/dev/pkg/README.md' }) },
      calls
    );
    const r = await fetchGitHubReadme('https://github.com/acme/app/tree/dev/pkg', { fetchImpl });
    expect(calls[0]).toBe('https://api.github.com/repos/acme/app/readme/pkg?ref=dev');
    expect(r.ok && r.source.kind === 'github' && r.source.rawBase).toBe('https://raw.githubusercontent.com/acme/app/dev/pkg/');
  });

  it('sends the token only to GitHub and only when given', async () => {
    let auth: string | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      auth = new Headers(init?.headers).get('authorization');
      return Response.json({ path: 'README.md', size: 1, content: b64('x'), encoding: 'base64', download_url: null });
    };
    await fetchGitHubReadme('acme/app', { fetchImpl, token: 'secret-token' });
    expect(auth).toBe('Bearer secret-token');
    await fetchGitHubReadme('acme/app', { fetchImpl });
    expect(auth).toBeNull();
  });

  it('maps 404 to NOT_FOUND after trying the raw fallback', async () => {
    const calls: string[] = [];
    const r = await fetchGitHubReadme('acme/missing', { fetchImpl: fakeFetch({}, calls) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.message).toBe('No README found for this repository.');
    }
    expect(calls[1]).toBe('https://raw.githubusercontent.com/acme/missing/HEAD/README.md');
  });

  it('uses the raw fallback when the API 404s but the file exists', async () => {
    const r = await fetchGitHubReadme('acme/app', {
      fetchImpl: fakeFetch({ 'https://raw.githubusercontent.com/acme/app/HEAD/README.md': () => new Response('# Raw') }),
    });
    expect(r.ok && r.markdown).toBe('# Raw');
  });

  it('maps rate limiting to RATE_LIMITED with the reset time', async () => {
    const r = await fetchGitHubReadme('acme/app', {
      fetchImpl: fakeFetch({
        'https://api.github.com/': () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } }),
        'https://raw.githubusercontent.com/': () => new Response('', { status: 429 }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('RATE_LIMITED');
      expect(r.error.resetAt).toBe(new Date(1900000000 * 1000).toISOString());
      expect(r.error.message).toMatch(/^GitHub rate limit reached\. Try again at .+\.$/);
    }
  });

  it('maps other 403/401 to PRIVATE_OR_FORBIDDEN', async () => {
    const r = await fetchGitHubReadme('acme/app', { fetchImpl: fakeFetch({ 'https://api.github.com/': () => new Response('{}', { status: 403 }) }) });
    expect(!r.ok && r.error.code).toBe('PRIVATE_OR_FORBIDDEN');
  });

  it('maps network errors to NETWORK', async () => {
    const r = await fetchGitHubReadme('acme/app', {
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(!r.ok && r.error.code).toBe('NETWORK');
  });

  it('rejects READMEs over 1 MB as TOO_LARGE', async () => {
    const r = await fetchGitHubReadme('acme/app', {
      fetchImpl: fakeFetch({ 'https://api.github.com/': () => Response.json({ path: 'README.md', size: 2_000_000, content: '', encoding: 'none' }) }),
    });
    expect(!r.ok && r.error.code).toBe('TOO_LARGE');
    const raw = await fetchGitHubReadme('https://raw.githubusercontent.com/a/b/main/README.md', {
      fetchImpl: fakeFetch({ 'https://raw.githubusercontent.com/': () => new Response('x'.repeat(2_000_000)) }),
    });
    expect(!raw.ok && raw.error.code).toBe('TOO_LARGE');
  });

  it('rejects invalid input without any network call', async () => {
    const calls: string[] = [];
    const r = await fetchGitHubReadme('https://evil.com/x/y', { fetchImpl: fakeFetch({}, calls) });
    expect(!r.ok && r.error.code).toBe('INVALID_URL');
    expect(calls).toHaveLength(0);
  });

  it('maps unexpected status and bad JSON to UNKNOWN', async () => {
    const r1 = await fetchGitHubReadme('acme/app', { fetchImpl: fakeFetch({ 'https://api.github.com/': () => new Response('x', { status: 500 }) }) });
    expect(!r1.ok && r1.error.code).toBe('UNKNOWN');
    const r2 = await fetchGitHubReadme('acme/app', { fetchImpl: fakeFetch({ 'https://api.github.com/': () => new Response('not json') }) });
    expect(!r2.ok && r2.error.code).toBe('UNKNOWN');
  });

  it('fetches blob and raw file URLs from raw.githubusercontent.com only', async () => {
    const calls: string[] = [];
    const r = await fetchGitHubReadme('https://github.com/acme/app/blob/main/docs/GUIDE.md', {
      fetchImpl: fakeFetch({ 'https://raw.githubusercontent.com/acme/app/main/docs/GUIDE.md': () => new Response('# Guide') }, calls),
    });
    expect(r.ok && r.markdown).toBe('# Guide');
    expect(calls).toEqual(['https://raw.githubusercontent.com/acme/app/main/docs/GUIDE.md']);
  });
});

describe('fetch helpers', () => {
  it('refFromDownloadUrl handles refs with slashes', () => {
    expect(refFromDownloadUrl('https://raw.githubusercontent.com/o/r/feature/x/docs/README.md', 'o', 'r', 'docs/README.md')).toBe('feature/x');
    expect(refFromDownloadUrl('https://evil.com/o/r/main/README.md', 'o', 'r', 'README.md')).toBeNull();
    expect(refFromDownloadUrl('not a url', 'o', 'r', 'README.md')).toBeNull();
  });

  it('decodeBase64Utf8 handles line breaks and unicode', () => {
    expect(decodeBase64Utf8(`${b64('héllo wörld').slice(0, 4)}\n${b64('héllo wörld').slice(4)}`)).toBe('héllo wörld');
  });

  it('cacheKeyFor normalises owner/repo case and spelling', () => {
    expect(cacheKeyFor('https://github.com/Acme/App')).toBe(cacheKeyFor('acme/app'));
    expect(cacheKeyFor('https://evil.com')).toBeNull();
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2, 1000);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('expires entries after the TTL', () => {
    let t = 0;
    const c = new LruCache<string, number>(5, 100, () => t);
    c.set('a', 1);
    t = 99;
    expect(c.has('a')).toBe(true);
    t = 100;
    expect(c.get('a')).toBeUndefined();
  });

  it('delete and clear', () => {
    const c = new LruCache<string, number>(5, 100);
    c.set('a', 1);
    expect(c.delete('a')).toBe(true);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('rejects a size below 1', () => {
    expect(() => new LruCache(0, 1)).toThrow();
  });
});
