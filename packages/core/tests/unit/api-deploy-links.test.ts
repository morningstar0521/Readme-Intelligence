import { describe, it, expect } from 'vitest';
import { extractApiEndpoints, hasApiSignals } from '../../src/extract/api';
import { extractDeployment } from '../../src/extract/deploy';
import { extractLinks, classifyLink } from '../../src/extract/links';
import { extractCommands } from '../../src/extract/commands';
import { ctxFor, md, GITHUB, PASTE } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');
const api = (markdown: string) => extractApiEndpoints(ctxFor(markdown));
const sig = (markdown: string) => api(markdown).map((e) => `${e.method} ${e.path}`);

describe('extractApiEndpoints', () => {
  it('reads METHOD /path lines in code blocks anywhere', () => {
    expect(sig(fence('http', 'GET /api/users', 'POST /api/users'))).toEqual(['GET /api/users', 'POST /api/users']);
  });

  it('reads headings with inline code in API sections and the paragraph after as description', () => {
    const [e] = api(md('## API', '### `GET /health`', 'Returns service status.'));
    expect(e).toMatchObject({ method: 'GET', path: '/health', description: 'Returns service status.' });
  });

  it('reads list items with descriptions', () => {
    const list = api(md('## Endpoints', '- `DELETE /items/:id` - remove an item', '- `PATCH /items/:id`: update'));
    expect(list.map((e) => [e.method, e.path, e.description])).toEqual([
      ['DELETE', '/items/:id', 'remove an item'],
      ['PATCH', '/items/:id', 'update'],
    ]);
  });

  it('reads Method / Endpoint tables', () => {
    const list = api(md('## API', '', '| Method | Endpoint | Description | Auth |', '|---|---|---|---|', '| GET | `/todos` | List todos | No |', '| POST | `/todos` | Create | Yes |'));
    expect(list.map((e) => [e.method, e.path, e.description, e.authRequired])).toEqual([
      ['GET', '/todos', 'List todos', null],
      ['POST', '/todos', 'Create', true],
    ]);
  });

	it('reads curl -X calls', () => {
		expect(sig(fence('bash', 'curl -X POST http://localhost:8000/api/login -d "{}"'))).toEqual(['POST /api/login']);
	});

	it('infers POST for curl requests with a request body but no -X flag', () => {
		expect(sig(fence('bash', "curl http://localhost:11434/api/chat -d '{\"model\":\"gemma\"}'"))).toEqual(['POST /api/chat']);
	});

	it('does not treat curl downloads as API endpoints', () => {
		expect(sig(fence('bash', 'curl -fsSL https://example.com/install.sh | sh', 'curl -o compose.yaml https://example.com/compose.yaml'))).toEqual([]);
	});

	it('reads HTTP endpoint comments inside code examples', () => {
		expect(sig(fence('rust', '// GET /', '// POST /users'))).toEqual(['GET /', 'POST /users']);
	});

  it('ignores prose outside API sections', () => {
    expect(sig(md('## Usage', 'Send GET /users to list users.'))).toEqual([]);
  });

  it('attaches request and response JSON examples by label', () => {
    const [e] = api(md('## API', '### `POST /login`', 'Request body:', fence('json', '{"user": "a"}'), 'Response:', fence('json', '{"token": "t"}')));
    expect(e!.requestExample).toBe('{"user": "a"}');
    expect(e!.responseExample).toBe('{"token": "t"}');
  });

  it('authRequired only when text mentions auth / token / bearer / API key', () => {
    const list = api(md('## API', '### `GET /me`', 'Requires a Bearer token.', '### `GET /ping`', 'Health check.'));
    expect(list.map((e) => e.authRequired)).toEqual([true, null]);
  });

  it('dedupes by method and path', () => {
    expect(sig(md('## API', '- `GET /a`', fence('', 'GET /a')))).toEqual(['GET /a']);
  });

  it('returns [] when there is no API', () => {
    expect(api(md('# App', 'Nothing here.'))).toEqual([]);
  });

  it('hasApiSignals', () => {
    expect(hasApiSignals(ctxFor(md('## API', 'Soon.')))).toBe(true);
    expect(hasApiSignals(ctxFor('Exposes a REST API on port 8080.'))).toBe(true);
    expect(hasApiSignals(ctxFor('A CLI tool.'))).toBe(false);
  });
});

describe('extractDeployment', () => {
  const deploy = (markdown: string) => {
    const ctx = ctxFor(markdown);
    return extractDeployment(ctx, extractCommands(ctx));
  };

  it('platforms and steps from the Deployment section', () => {
    const d = deploy(md('## Deployment', '- Push to main; Vercel builds it', '- Database runs on Railway'));
    expect(d.platforms).toEqual(['Vercel', 'Railway']);
    expect(d.steps.map((s) => s.value)).toEqual(['Push to main; Vercel builds it', 'Database runs on Railway']);
  });

  it('platforms from deploy commands anywhere', () => {
    expect(deploy(fence('bash', 'fly deploy')).platforms).toEqual(['Fly.io']);
  });

  it('platforms from deploy buttons', () => {
    expect(deploy('[![Deploy](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=x)').platforms).toEqual(['Vercel']);
  });

  it('Docker and Kubernetes in a Deploy section', () => {
    expect(deploy(md('## Deploy', 'Build the Docker image and apply the Kubernetes manifests.')).platforms).toEqual(['Docker', 'Kubernetes']);
  });

  it('empty when nothing is said', () => {
    expect(deploy(md('# App'))).toEqual({ platforms: [], steps: [] });
  });
});

describe('extractLinks', () => {
  const links = (markdown: string, source = PASTE) => extractLinks(ctxFor(markdown, source), source);

  it('classifies links by URL and text', () => {
    const l = links(
      md(
        '[Repo](https://github.com/acme/app) [Demo](https://app.vercel.app) [Docs](https://docs.app.dev)',
        '[Video](https://youtu.be/x) [Bugs](https://github.com/acme/app/issues) [Chat](https://discord.gg/x)',
        '[License](https://github.com/acme/app/blob/main/LICENSE) [Blog](https://blog.example.com)'
      )
    );
    expect(l.map((x) => x.type)).toEqual(['repo', 'demo', 'docs', 'video', 'issues', 'chat', 'license', 'other']);
  });

  it('excludes anchors and badge-only links, dedupes by URL', () => {
    const l = links(md('[Top](#top) [![CI](https://img.shields.io/x)](https://ci.example.com)', '[Site](https://a.dev) [Again](https://a.dev)'));
    expect(l.map((x) => x.url)).toEqual(['https://a.dev']);
  });

  it('resolves relative links against GitHub', () => {
    expect(links('[Guide](docs/guide.md)', GITHUB)[0]!.url).toBe('https://github.com/acme/taskflow/blob/main/docs/guide.md');
  });

  it('drops relative links for pasted sources and unsafe schemes', () => {
    expect(links('[Guide](docs/guide.md) [x](javascript:alert(1))')).toEqual([]);
  });

  it('reads reference-style links and HTML anchors', () => {
    const l = links(md('See [the docs][d].', '', '[d]: https://docs.example.com', '', '<a href="https://example.com/demo">Live demo</a>'));
    expect(l.map((x) => [x.type, x.url])).toEqual([
      ['docs', 'https://docs.example.com'],
      ['demo', 'https://example.com/demo'],
    ]);
  });

  it('keeps source lines', () => {
    expect(links(md('# A', '', '[x](https://x.dev)'))[0]!.source).toMatchObject({ line: 3 });
  });

  it('classifyLink', () => {
    expect(classifyLink('https://myapp.netlify.app', 'site')).toBe('demo');
    expect(classifyLink('https://proj.readthedocs.io/en/latest', 'read')).toBe('docs');
    expect(classifyLink('https://vimeo.com/1', 'x')).toBe('video');
    expect(classifyLink('https://github.com/acme', 'profile')).toBe('other');
  });
});
