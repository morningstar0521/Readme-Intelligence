import { describe, it, expect } from 'vitest';
import { extractEnvVars, maskValue, isPlaceholderValue, looksLikeSecretValue, requiredFromText, MASK } from '../../src/extract/env';
import { ctxFor, md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');
const env = (markdown: string) => extractEnvVars(ctxFor(markdown));
const names = (markdown: string) => env(markdown).map((e) => e.name);

describe('extractEnvVars', () => {
  it('reads .env code blocks', () => {
    expect(names(fence('env', 'DATABASE_URL=postgres://localhost/db', 'PORT=3000'))).toEqual(['DATABASE_URL', 'PORT']);
  });

  it('accepts dotenv, .env, ini and bash labels', () => {
    for (const lang of ['dotenv', '.env', 'ini', 'bash']) {
      expect(names(fence(lang, 'API_URL=https://api.example.com'))).toEqual(['API_URL']);
    }
  });

  it('reads unlabeled blocks where at least half the lines are NAME=value', () => {
    expect(names(fence('', 'REDIS_URL=redis://localhost', 'LOG_LEVEL=info', 'some note'))).toEqual(['REDIS_URL', 'LOG_LEVEL']);
    expect(names(fence('', 'note one', 'note two', 'LOG_LEVEL=info'))).toEqual([]);
  });

  it('ignores constants in programming language blocks', () => {
    expect(names(fence('python', 'DEBUG = True', 'SECRET_KEY = "x"'))).toEqual([]);
  });

  it('reads export lines', () => {
    expect(names(fence('sh', 'export GITHUB_TOKEN=ghp_abc', 'npm start'))).toEqual(['GITHUB_TOKEN']);
  });

  it('does not treat one-off command prefixes as variables', () => {
    expect(names(fence('bash', 'NODE_ENV=production npm start'))).toEqual([]);
  });

  it('takes descriptions from same-line and previous-line comments', () => {
    const vars = env(fence('env', '# Postgres connection string', 'DATABASE_URL=postgres://x', 'PORT=3000 # HTTP port'));
    expect(vars.map((v) => v.description)).toEqual(['Postgres connection string', 'HTTP port']);
  });

  it('detects required / optional from nearby text', () => {
    const vars = env(fence('env', 'A_KEY=1 # required', 'B_FLAG=true # optional', 'C_URL=x # defaults to localhost', 'D_NAME=x'));
    expect(vars.map((v) => v.required)).toEqual([true, false, false, null]);
  });

  it('masks secret-looking values and keeps placeholders visible', () => {
    const vars = env(fence('env', 'OPENAI_API_KEY=sk-abc123def456ghi789', 'STRIPE_SECRET=your_secret_here', 'APP_NAME=taskflow', 'JWT_SECRET=<your-secret>'));
    expect(vars.map((v) => [v.name, v.exampleValue, v.masked])).toEqual([
      ['OPENAI_API_KEY', MASK, true],
      ['STRIPE_SECRET', 'your_secret_here', false],
      ['APP_NAME', 'taskflow', false],
      ['JWT_SECRET', '<your-secret>', false],
    ]);
  });

  it('masks long random tokens even when the name looks harmless', () => {
    const [v] = env(fence('env', 'SESSION_ID=a8f5f167f44f4964e6c998dee827110c'));
    expect(v).toMatchObject({ masked: true, exampleValue: MASK });
  });

  it('never leaks the original secret anywhere in the output', () => {
    const out = JSON.stringify(env(fence('env', 'OPENAI_API_KEY=sk-abc123def456ghi789')));
    expect(out).not.toContain('sk-abc123');
  });

  it('reads tables with a Variable column, plus Required and Description columns', () => {
    const vars = env(
      md(
        '| Variable | Required | Description | Default |',
        '|---|---|---|---|',
        '| `DATABASE_URL` | Yes | Postgres URL | - |',
        '| `PORT` | No | HTTP port | `3000` |',
        '| not_env | Yes | lowercase is ignored | |'
      )
    );
    expect(vars.map((v) => [v.name, v.required, v.description, v.exampleValue])).toEqual([
      ['DATABASE_URL', true, 'Postgres URL', '-'],
      ['PORT', false, 'HTTP port', '3000'],
    ]);
  });

  it('reads Name / Key / Env columns', () => {
    expect(names(md('| Name | Purpose |', '|---|---|', '| SENTRY_DSN | Error tracking |'))).toEqual(['SENTRY_DSN']);
    expect(names(md('| Key | Value |', '|---|---|', '| REDIS_HOST | localhost |'))).toEqual(['REDIS_HOST']);
  });

  it('reads list items and inline code in configuration sections only', () => {
    const doc = md('## Configuration', '', '- `MAX_UPLOAD_MB`: maximum upload size (optional)', '- `ADMIN_EMAIL` - who gets alerts', '', 'Set `LOG_FORMAT` to json.', '', '## Usage', '', 'Set `OTHER_VAR` here.');
    const vars = env(doc);
    expect(vars.map((v) => v.name)).toEqual(['MAX_UPLOAD_MB', 'ADMIN_EMAIL', 'LOG_FORMAT']);
    expect(vars[0]).toMatchObject({ description: 'maximum upload size (optional)', required: false });
    expect(vars[1]!.description).toBe('who gets alerts');
  });

  it('reads variables named in setup prose outside a Configuration heading', () => {
    const vars = env(md(
      '# App',
      '',
      'For non-Vercel deployments set the `AI_GATEWAY_API_KEY` environment variable.',
      'Set `DATABASE_URL` in `.env.local` before starting the server.',
    ));
    expect(vars.map((v) => v.name)).toEqual(['AI_GATEWAY_API_KEY', 'DATABASE_URL']);
  });

  it('reads environment variables listed under installation setup', () => {
    expect(names(md(
      '## Setting Up Locally',
      '',
      '- `OPENAI_API_KEY` - your OpenAI API key',
      '- `BLOB_READ_WRITE_TOKEN` - your blob token',
    ))).toEqual(['OPENAI_API_KEY', 'BLOB_READ_WRITE_TOKEN']);
  });

  it('reads export assignments embedded in prose code spans', () => {
    expect(names(md('## Configuration', '', 'Add `export NODE_OPTIONS="--max-old-space-size=16384"` to your shell script.'))).toEqual(['NODE_OPTIONS']);
  });

  it('reads lowercase shell environment assignments when they are explicit variables', () => {
    expect(names(fence('bash', 'export python_cmd="python3.11"', 'python_cmd="python3.11"'))).toEqual(['python_cmd']);
  });

  it('reads environment access from Python and JavaScript examples', () => {
    expect(names(md(
      fence('python', 'import os', 'token = os.environ["OPENAI_API_KEY"]'),
      fence('js', 'const token = process.env.BLOB_READ_WRITE_TOKEN;'),
    ))).toEqual(['OPENAI_API_KEY', 'BLOB_READ_WRITE_TOKEN']);
  });

  it('reads a variable named in installation prose', () => {
    expect(names(md('## Installation', '', 'Pass `DOCKER_API_VERSION` set to the maximum API version from the error.'))).toEqual(['DOCKER_API_VERSION']);
  });

  it('does not treat arbitrary inline code words as environment variables', () => {
    expect(names(md('New users are set on a `TRIAL` plan.', 'Install `setuptools_rust` if the wheel is unavailable.'))).toEqual([]);
  });

  it('reads PowerShell environment assignments in a setup block', () => {
    expect(names(md('```powershell', '$env:DATABASE_URL="postgres://localhost/db"', '$env:API_KEY="example"', '```'))).toEqual([
      'DATABASE_URL',
      'API_KEY',
    ]);
  });

  it('reads plain uppercase variables from configuration prose', () => {
    const vars = env(md(
      '## Configure App',
      '',
      'Optional: set API_URL to change the base URL.',
      'Relative paths are served under BASE_PATH.',
      'Set MCP_ENABLED=1 to enable the endpoint.',
    ));
    expect(vars.map((v) => v.name)).toEqual(['API_URL', 'BASE_PATH', 'MCP_ENABLED']);
  });

  it('reads variables named in list-form setup prose', () => {
    expect(names(md(
      '## Configuration',
      '',
      '- Set CSP_POLICY to enable strict content security policy.',
      '- Provide GOOGLE_API_CREDENTIALS in the .env file.',
    ))).toEqual(['CSP_POLICY', 'GOOGLE_API_CREDENTIALS']);
  });

  it('reads an assigned variable from inline setup prose', () => {
    expect(names('If needed, set `NODE_TLS_REJECT_UNAUTHORIZED=0` before starting the server.')).toEqual(['NODE_TLS_REJECT_UNAUTHORIZED']);
  });

  it('reads a variable named in an environment-variable error message', () => {
    expect(names('If you see `Environment variable not found: DATABASE_DIRECT_URL`, configure the database connection.')).toEqual(['DATABASE_DIRECT_URL']);
  });

  it('ignores common all-caps words', () => {
    expect(names(md('## Configuration', '', 'Use `JSON` over `HTTP` for the `API`.'))).toEqual([]);
  });

  it('merges duplicates: first source, first description, first non-null required', () => {
    const vars = env(md(fence('env', 'DATABASE_URL=postgres://x'), '', '| Variable | Required | Description |', '|---|---|---|', '| DATABASE_URL | Yes | Main database |'));
    expect(vars).toHaveLength(1);
    expect(vars[0]).toMatchObject({ name: 'DATABASE_URL', required: true, description: 'Main database', source: { line: 2 } });
  });

  it('returns [] when nothing is documented', () => {
    expect(env(md('# App', 'No config.'))).toEqual([]);
    expect(env('')).toEqual([]);
  });

  it('handles quoted values', () => {
    const [v] = env(fence('env', 'GREETING="hello world" # shown on home page'));
    expect(v).toMatchObject({ exampleValue: 'hello world', description: 'shown on home page' });
  });
});

describe('masking helpers', () => {
  it('isPlaceholderValue', () => {
    for (const v of ['', 'your_api_key_here', '<token>', 'xxx', 'changeme', '${API_KEY}', '...', 'replace-me']) expect(isPlaceholderValue(v)).toBe(true);
    for (const v of ['sk-live-1234567890', 'production', 'postgres://u:p@h/db']) expect(isPlaceholderValue(v)).toBe(false);
  });

  it('looksLikeSecretValue', () => {
    for (const v of ['sk-abcdef123456', 'ghp_1234567890abcdefgh', 'AKIAIOSFODNN7EXAMPLE1', '-----BEGIN RSA PRIVATE KEY-----', 'xoxb-1234567890-abc', 'dGhpcyBpcyBhIGxvbmcgc2VjcmV0IDEyMw==']) {
      expect(looksLikeSecretValue(v)).toBe(true);
    }
    expect(looksLikeSecretValue('localhost')).toBe(false);
    expect(looksLikeSecretValue('')).toBe(false);
  });

  it('maskValue keeps booleans and small numbers visible', () => {
    expect(maskValue('AUTH_ENABLED', 'true')).toEqual({ exampleValue: 'true', masked: false });
    expect(maskValue('TOKEN_TTL', '3600')).toEqual({ exampleValue: '3600', masked: false });
    expect(maskValue('DB_PASSWORD', 'hunter2')).toEqual({ exampleValue: MASK, masked: true });
    expect(maskValue('X', null)).toEqual({ exampleValue: null, masked: false });
  });

  it('requiredFromText', () => {
    expect(requiredFromText('This is required')).toBe(true);
    expect(requiredFromText('Mandatory for prod')).toBe(true);
    expect(requiredFromText('optional')).toBe(false);
    expect(requiredFromText('Defaults to 3000')).toBe(false);
    expect(requiredFromText('Some text')).toBeNull();
    expect(requiredFromText(null)).toBeNull();
  });
});
