/**
 * Parse user input into a GitHub target. Pure and synchronous.
 *
 * Accepted:
 *   https://github.com/owner/repo                 (also without scheme, with www., .git, trailing slash, ?query, #hash)
 *   https://github.com/owner/repo/tree/ref/dir    (README of a sub directory)
 *   https://github.com/owner/repo/blob/ref/path   (a specific Markdown file)
 *   https://raw.githubusercontent.com/owner/repo/ref/path
 *   owner/repo                                    (shorthand)
 *
 * Everything else, including other hosts, IP addresses and localhost, is rejected (SSRF allow-list).
 * Note: refs that contain "/" are ambiguous in tree/blob URLs; the first segment is used as the ref.
 */

export type GitHubTarget =
  | { kind: 'repo'; owner: string; repo: string; ref: string | null; dir: string }
  | { kind: 'file'; owner: string; repo: string; ref: string; path: string };

export type ParseGitHubResult =
  | { ok: true; target: GitHubTarget }
  | { ok: false; code: 'INVALID_URL'; message: string };

export const INVALID_URL_MESSAGE = 'That does not look like a GitHub repository or README link.';

export const ALLOWED_INPUT_HOSTS = ['github.com', 'www.github.com', 'raw.githubusercontent.com'] as const;
/** Hosts the server is allowed to call. */
export const ALLOWED_FETCH_HOSTS = ['api.github.com', 'raw.githubusercontent.com'] as const;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,255}$/;

/** First path segments on github.com that are not user or org names. */
const RESERVED_OWNERS = new Set([
  'about',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

function invalid(): ParseGitHubResult {
  return { ok: false, code: 'INVALID_URL', message: INVALID_URL_MESSAGE };
}

function validOwnerRepo(owner: string | undefined, repo: string | undefined): repo is string {
  if (!owner || !repo) return false;
  if (!OWNER_RE.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase())) return false;
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') return false;
  return true;
}

function cleanSegments(path: string): string[] | null {
  const segments: string[] = [];
  for (const raw of path.split('/')) {
    if (raw === '') continue;
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (seg === '.' || seg === '..' || /[\u0000-\u001f\\]/.test(seg)) return null;
    segments.push(seg);
  }
  return segments;
}

export function parseGitHubInput(input: string): ParseGitHubResult {
  if (typeof input !== 'string') return invalid();
  let text = input.trim();
  if (!text || text.length > 2048) return invalid();

  // owner/repo shorthand. Owner names cannot contain dots, so "github.com/x" never matches here.
  const short = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(text);
  if (short) {
    const repo = short[2]!.replace(/\.git$/i, '');
    if (!validOwnerRepo(short[1], repo)) return invalid();
    return { ok: true, target: { kind: 'repo', owner: short[1]!, repo, ref: null, dir: '' } };
  }

  // Reject dot segments before URL parsing normalises them away ("/blob/main/../../x").
  if (/(?:^|[/\\])(?:\.|%2e){1,2}(?=[/\\?#]|$)/i.test(text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))) return invalid();

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid();
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid();
  if (url.username || url.password) return invalid();
  if (url.port !== '') return invalid();
  const host = url.hostname.toLowerCase();
  if (!(ALLOWED_INPUT_HOSTS as readonly string[]).includes(host)) return invalid();

  const segments = cleanSegments(url.pathname);
  if (!segments) return invalid();

  if (host === 'raw.githubusercontent.com') {
    // /owner/repo/ref/path...   or   /owner/repo/refs/heads/ref/path...
    const [owner, repo, ...rest] = segments;
    if (!validOwnerRepo(owner, repo)) return invalid();
    let ref: string | undefined;
    let pathSegs: string[];
    if (rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags') && rest.length >= 4) {
      ref = rest[2];
      pathSegs = rest.slice(3);
    } else {
      ref = rest[0];
      pathSegs = rest.slice(1);
    }
    if (!ref || !REF_RE.test(ref) || pathSegs.length === 0) return invalid();
    return { ok: true, target: { kind: 'file', owner: owner!, repo, ref, path: pathSegs.join('/') } };
  }

  // github.com
  const [owner, repoRaw, mode, ref, ...rest] = segments;
  const repo = repoRaw?.replace(/\.git$/i, '');
  if (!validOwnerRepo(owner, repo)) return invalid();

  if (mode === 'tree') {
    if (!ref || !REF_RE.test(ref)) return invalid();
    return { ok: true, target: { kind: 'repo', owner: owner!, repo, ref, dir: rest.join('/') } };
  }
  if (mode === 'blob' || mode === 'raw') {
    if (!ref || !REF_RE.test(ref) || rest.length === 0) return invalid();
    return { ok: true, target: { kind: 'file', owner: owner!, repo, ref, path: rest.join('/') } };
  }
  // Any other sub page (issues, pulls, wiki...) or none: use the repo root README.
  return { ok: true, target: { kind: 'repo', owner: owner!, repo, ref: null, dir: '' } };
}

/** Legacy convenience used by some callers: returns the target or null. */
export function parseGitHubUrl(input: string): GitHubTarget | null {
  const result = parseGitHubInput(input);
  return result.ok ? result.target : null;
}
