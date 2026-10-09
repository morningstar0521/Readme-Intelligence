import { test, expect, type Page } from '@playwright/test';

const PASTED = [
  '# Demo App',
  '',
  'A demo application used by the end-to-end tests of the viewer.',
  '',
  '## Installation',
  '',
  '```bash',
  'npm install',
  'npm run dev',
  '```',
  '',
  '## Configuration',
  '',
  '```env',
  'DATABASE_URL=postgres://localhost/demo',
  'OPENAI_API_KEY=sk-abc123def456ghi789',
  '```',
  '',
  ...Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1} to make the page scroll.`),
  '',
  '## Deep Section',
  '',
  'The end.',
].join('\n');

async function pasteAndOpen(page: Page, markdown = PASTED) {
  await page.goto('/');
  await page.getByTestId('paste-toggle').click();
  await page.getByTestId('paste-input').fill(markdown);
  await page.getByTestId('paste-submit').click();
  await expect(page.getByTestId('markdown')).toBeVisible();
}

test('1. pasted Markdown renders with intelligence cards', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await pasteAndOpen(page);

  await expect(
    page.getByTestId('markdown').getByRole('heading', { name: 'Demo App', level: 1 })
  ).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveText('Demo App');
  await expect(page.getByTestId('card-commands')).toContainText('npm install');
  await expect(page.getByTestId('card-env')).toContainText('DATABASE_URL');
  // Secret is masked in the UI.
  await expect(page.getByTestId('card-env')).toContainText('••••••••');
  await expect(page.getByTestId('card-env')).not.toContainText('sk-abc123');
  // Empty states never invent data.
  await expect(page.getByTestId('card-api')).toContainText('Not found in README');
  await expect(page.getByTestId('health-score')).toBeVisible();
  await expect(page.getByTestId('source-badge')).toContainText('Pasted');
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('1a. intelligence can expand into a full-screen overview and return to reader view', async ({
  page,
}) => {
  await pasteAndOpen(page);
  await page.getByRole('button', { name: 'Full-screen overview' }).click();
  await expect(page.getByTestId('intelligence-overview')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project intelligence' })).toBeVisible();
  await expect(page.getByTestId('card-commands')).toBeVisible();

  await page.getByRole('button', { name: 'Reader view' }).click();
  await expect(page.getByTestId('intelligence')).toBeVisible();
  await expect(page.getByTestId('markdown')).toBeVisible();
});

test('1b. pasted API documentation appears in the endpoint card', async ({ page }) => {
  await pasteAndOpen(
    page,
    [
      '# API Demo',
      '',
      '## REST API',
      '',
      '```bash',
      `curl http://localhost:8000/api/tasks -d '{"title":"demo"}'`,
      '```',
      '',
    ].join('\n')
  );
  await expect(page.getByTestId('card-api')).toContainText('POST');
  await expect(page.getByTestId('card-api')).toContainText('/api/tasks');
});

test('2. a GitHub URL loads the README (API mocked)', async ({ page }) => {
  // 1x1 transparent PNG so the resolved image loads instead of falling back to the placeholder.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  await page.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png })
  );
  await page.route('**/api/github/readme**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        markdown:
          '# Mocked Repo\n\nFetched from a mocked GitHub API.\n\n![shot](docs/shot.png)\n\n## Usage\n\n```bash\nnpm start\n```\n',
        source: {
          kind: 'github',
          owner: 'acme',
          repo: 'mocked',
          ref: 'main',
          path: 'README.md',
          rawBase: 'https://raw.githubusercontent.com/acme/mocked/main/',
          htmlUrl: 'https://github.com/acme/mocked/blob/main/README.md',
        },
      }),
    });
  });
  await page.goto('/');
  await page.getByTestId('url-input').fill('https://github.com/acme/mocked');
  await page.getByTestId('open-button').click();
  await expect(
    page.getByTestId('markdown').getByRole('heading', { name: 'Mocked Repo' })
  ).toBeVisible();
  await expect(page.getByTestId('source-badge')).toContainText('GitHub');
  // Relative image resolved against raw.githubusercontent.com.
  await expect(page.locator('[data-testid="markdown"] img').first()).toHaveAttribute(
    'src',
    'https://raw.githubusercontent.com/acme/mocked/main/docs/shot.png'
  );
});

test('3. Cmd/Ctrl+K search finds a heading and Enter scrolls to it', async ({ page }) => {
  await pasteAndOpen(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('Deep Section');
  await expect(page.getByRole('option').first()).toContainText('Deep Section');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#deep-section')).toBeInViewport();

  // Commands and env vars are searchable too.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByTestId('palette-input').fill('DATABASE_URL');
  await expect(page.locator('[role="option"][data-kind="env"]').first()).toContainText(
    'DATABASE_URL'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('4. theme choice persists after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('[data-theme-option="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('[data-theme-option="dark"]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('5. an invalid URL shows the friendly error copy', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('url-input').fill('https://example.com/not/github');
  await page.getByTestId('open-button').click();
  await expect(page.getByTestId('url-error')).toHaveText(
    'That does not look like a GitHub repository or README link.'
  );

  // Direct navigation with a bad URL reaches the API route and shows the error state.
  await page.goto('/view?url=https%3A%2F%2Fevil.com%2Fx%2Fy');
  await expect(page.getByTestId('error-message')).toHaveText(
    'That does not look like a GitHub repository or README link.'
  );
  await expect(page.getByRole('link', { name: 'Open another' })).toBeVisible();
});

test('6. jump to source scrolls to the line in the README', async ({ page }) => {
  await pasteAndOpen(page);
  await page
    .getByTestId('card-env')
    .getByRole('button', { name: /Jump to source/ })
    .first()
    .click();
  // The highlight is intentionally short-lived. Waiting for it to be in the
  // viewport directly avoids a race between two assertions and the 1.7s flash.
  await expect(page.locator('.jump-highlight')).toBeInViewport();
});

test('7. a local file is rendered without any network request for its content', async ({
  page,
}) => {
  await page.goto('/');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByTestId('file-input').setInputFiles({
    name: 'LOCAL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Local Only\n\nSecret local content.'),
  });
  await expect(
    page.getByTestId('markdown').getByRole('heading', { name: 'Local Only' })
  ).toBeVisible();
  // The file is read with FileReader in the browser: no API call, and the content is in no URL.
  expect(requests.some((u) => u.includes('/api/'))).toBe(false);
  expect(requests.some((u) => u.includes('Secret'))).toBe(false);
  await expect(page.getByTestId('source-badge')).toContainText('Local');
});

test('8. repository reality check finds a contradiction and an undocumented env var (API mocked)', async ({
  page,
}) => {
  const source = {
    kind: 'github',
    owner: 'acme',
    repo: 'drift',
    ref: 'main',
    path: 'README.md',
    rawBase: 'https://raw.githubusercontent.com/acme/drift/main/',
    htmlUrl: 'https://github.com/acme/drift/blob/main/README.md',
  };
  await page.route('**/api/github/readme**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        source,
        markdown:
          '# Drift\n\nA demo repo whose README drifted from the code.\n\n## Usage\n\n```bash\nnpm install\nnpm run start:dev\n```\n',
      }),
    })
  );
  await page.route('**/api/github/repo**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        skipped: [],
        snapshot: {
          owner: 'acme',
          repo: 'drift',
          ref: 'main',
          baseDir: '',
          truncated: false,
          tree: ['package.json', 'package-lock.json', 'src/server.js'],
          files: {
            'package.json': '{\n  "scripts": {\n    "dev": "node src/server.js"\n  }\n}',
            'src/server.js': 'const key = process.env.SESSION_SECRET;',
          },
        },
      }),
    })
  );
  await page.goto('/view?url=https%3A%2F%2Fgithub.com%2Facme%2Fdrift');
  await page.getByTestId('run-reality-check').click();
  const results = page.getByTestId('reality-results');
  await expect(results).toBeVisible();
  await expect(page.locator('[data-claim-id="script:start:dev"]')).toHaveAttribute(
    'data-status',
    'contradiction'
  );
  await expect(page.locator('[data-claim-id="env:SESSION_SECRET"]')).toHaveAttribute(
    'data-status',
    'repo-only'
  );
  await expect(page.getByTestId('readiness-score')).toBeVisible();
});
