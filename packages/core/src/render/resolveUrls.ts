import type { SourceInfo } from '../types';

/**
 * Relative URL resolution (Technical design 3.5).
 *
 * | Input                          | Output                                                        |
 * | `./img/a.png`, `img/a.png`     | `{rawBase}img/a.png` (images)                                 |
 * | `/docs/a.png`                  | `https://raw.githubusercontent.com/owner/repo/ref/docs/a.png` |
 * | `docs/guide.md` (link)         | `https://github.com/owner/repo/blob/ref/docs/guide.md`        |
 * | `#section`                     | unchanged                                                     |
 * | `https://...`                  | unchanged                                                     |
 * | `javascript:`, unsafe `data:`  | removed (null)                                                |
 *
 * For local and pasted sources, relative images cannot be loaded and return null
 * (the UI shows "Image unavailable" with the original path).
 */

export type UrlKind = 'link' | 'image';

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** Remove ASCII control characters and whitespace that browsers ignore inside schemes. */
function normaliseForSchemeCheck(url: string): string {
  // eslint-disable-next-line no-control-regex
  return url.replace(/[\u0000- \u007F-\u009F]/g, '').toLowerCase();
}

/** Returns the lowercase scheme ("https", "javascript", ...) or null for relative URLs. */
export function getScheme(url: string): string | null {
  const cleaned = normaliseForSchemeCheck(url);
  const match = /^([a-z][a-z0-9+.-]*):/.exec(cleaned);
  if (!match) return null;
  // A colon after a "/", "?" or "#" does not start a scheme ("a/b:c" is relative).
  const firstSpecial = cleaned.search(/[/?#]/);
  if (firstSpecial !== -1 && firstSpecial < match[0].length - 1) return null;
  return match[1]!;
}

export function isSafeDataImage(url: string): boolean {
  return SAFE_DATA_IMAGE.test(url.trim());
}

/** True when the URL is absolute and uses a scheme we allow for the given kind. */
export function isAllowedAbsolute(url: string, kind: UrlKind): boolean {
  const scheme = getScheme(url);
  if (scheme === null) return false;
  if (scheme === 'http' || scheme === 'https') return true;
  if (kind === 'link' && scheme === 'mailto') return true;
  if (kind === 'image' && scheme === 'data') return isSafeDataImage(url);
  return false;
}

/** Join a base directory URL and a relative path, normalising "." and ".." segments. */
function joinPath(baseDir: string, relative: string): string {
  const [pathPart, ...rest] = relative.split(/(?=[?#])/);
  const suffix = rest.join('');
  const baseSegments = baseDir.split('/').filter(Boolean);
  for (const seg of (pathPart ?? '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') baseSegments.pop();
    else baseSegments.push(seg);
  }
  const trailing = (pathPart ?? '').endsWith('/') ? '/' : '';
  return baseSegments.join('/') + trailing + suffix;
}

/** Directory of the README inside the repo, without leading or trailing slashes ("" for root). */
export function readmeDir(path: string): string {
  const clean = path.replace(/^\/+/, '');
  const idx = clean.lastIndexOf('/');
  return idx === -1 ? '' : clean.slice(0, idx);
}

/** github.com/owner/repo/blob/ref/path image links point at an HTML page; turn them into raw URLs. */
function githubBlobToRaw(url: string): string | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+?)(\?raw=true)?$/i.exec(url);
  if (!m) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * Resolve one URL found in the README.
 * Returns the URL to use, or null if it must be removed or cannot be loaded.
 */
export function resolveUrl(rawUrl: string, kind: UrlKind, source: SourceInfo): string | null {
  if (typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (url === '') return null;

  // In-page anchors stay as they are.
  if (url.startsWith('#')) return kind === 'link' ? url : null;

  const scheme = getScheme(url);
  if (scheme !== null) {
    if (!isAllowedAbsolute(url, kind)) return null;
    if (kind === 'image') return githubBlobToRaw(url) ?? url;
    return url;
  }

  // Protocol-relative URLs: treat as https.
  if (url.startsWith('//')) return `https:${url}`;

  if (source.kind !== 'github') return null;

  const { owner, repo, ref } = source;
  const dir = readmeDir(source.path);
  const isRootRelative = url.startsWith('/');
  const repoPath = isRootRelative ? joinPath('', url.slice(1)) : joinPath(dir, url);

  if (kind === 'image') {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${repoPath}`;
  }
  return `https://github.com/${owner}/${repo}/blob/${ref}/${repoPath}`;
}

/**
 * Resolve every candidate inside a srcset attribute. Returns null if any candidate is unsafe
 * or cannot be resolved, so the whole <source> is dropped rather than partially loaded.
 */
export function resolveSrcSet(srcset: string, source: SourceInfo): string | null {
  const candidates = srcset
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (candidates.length === 0) return null;
  const out: string[] = [];
  for (const candidate of candidates) {
    const [url, ...descriptor] = candidate.split(/\s+/);
    const resolved = resolveUrl(url ?? '', 'image', source);
    if (!resolved) return null;
    out.push([resolved, ...descriptor].join(' '));
  }
  return out.join(', ');
}
