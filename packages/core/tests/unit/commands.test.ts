import { describe, it, expect } from 'vitest';
import {
  extractCommands,
  categorizeCommand,
  isRiskyCommand,
  parseCommandLines,
  isCommandLine,
  joinContinuations,
  commandLineRatio,
  stripPrompt,
  isInlineCommand,
} from '../../src/extract/commands';
import { ctxFor, md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');
const commands = (markdown: string) => extractCommands(ctxFor(markdown));
const cmdText = (markdown: string) => commands(markdown).map((c) => c.command);

describe('extractCommands', () => {
  it('reads shell code blocks', () => {
    expect(cmdText(fence('bash', 'npm install', 'npm run dev'))).toEqual(['npm install', 'npm run dev']);
  });

  it('accepts sh, zsh, console, powershell, cmd and terminal blocks', () => {
    for (const lang of ['sh', 'zsh', 'shell', 'console', 'powershell', 'cmd', 'terminal']) {
      expect(cmdText(fence(lang, 'pip install -r requirements.txt'))).toEqual(['pip install -r requirements.txt']);
    }
  });

  it('strips "$ " and "> " prompts', () => {
    expect(cmdText(fence('console', '$ npm test', '> yarn build', 'PS> dotnet run'))).toEqual(['npm test', 'yarn build', 'dotnet run']);
  });

  it('skips comment lines and output lines', () => {
    expect(cmdText(fence('bash', '# install deps', 'npm ci', 'added 120 packages in 3s', '// comment', 'Server running on port 3000'))).toEqual(['npm ci']);
  });

  it('joins continued lines', () => {
    expect(cmdText(fence('bash', 'docker run \\', '  -p 3000:3000 \\', '  my-image'))).toEqual(['docker run -p 3000:3000 my-image']);
  });

  it('removes trailing comments when safe', () => {
    expect(cmdText(fence('bash', 'npm run build # produces dist/'))).toEqual(['npm run build']);
    expect(cmdText(fence('bash', 'git commit -m "fix #12"'))).toEqual(['git commit -m "fix #12"']);
  });

  it('reads unlabeled blocks only when most lines are commands', () => {
    expect(cmdText(fence('', 'npm install', 'npm start'))).toEqual(['npm install', 'npm start']);
    expect(cmdText(fence('', 'some output', 'more output', 'npm start'))).toEqual([]);
  });

  it('ignores code in programming languages', () => {
    expect(cmdText(fence('js', 'npm.install()', "const x = require('git')"))).toEqual([]);
    expect(cmdText(fence('json', '{"scripts": {"dev": "next dev"}}'))).toEqual([]);
  });

  it('reads inline code that looks like a command', () => {
    expect(cmdText('Run `npm run dev` and open the app. Use `npm` or `yarn`.')).toEqual(['npm run dev']);
  });

  it('dedupes identical commands and keeps the first source', () => {
    const list = commands(md(fence('bash', 'npm install'), '', 'Then `npm install` again.', '', fence('bash', 'npm  install')));
    expect(list).toHaveLength(1);
    expect(list[0]!.source.line).toBe(2);
  });

  it('records language, line and heading path', () => {
    const [c] = commands(md('# App', '## Setup', fence('bash', '', 'pnpm install')));
    expect(c).toMatchObject({ command: 'pnpm install', language: 'bash', category: 'setup', source: { line: 5, headingPath: ['App', 'Setup'] } });
  });

  it('accepts env prefixes and sudo', () => {
    expect(cmdText(fence('bash', 'NODE_ENV=production node server.js', 'sudo apt-get install -y ffmpeg'))).toEqual([
      'NODE_ENV=production node server.js',
      'sudo apt-get install -y ffmpeg',
    ]);
  });

  it('recognizes common project CLIs that are not shell built-ins', () => {
    expect(cmdText(fence('bash', 'rg -uuu', 'bat README.md', 'fzf --height 40%', 'whisper audio.wav --model medium', 'streamlit hello', './gitea web'))).toEqual([
      'rg -uuu',
      'bat README.md',
      'fzf --height 40%',
      'whisper audio.wav --model medium',
      'streamlit hello',
      './gitea web',
    ]);
  });

  it('recognizes executable examples in inline code', () => {
    expect(cmdText('Try `ollama run llama3.2`, `express /tmp/foo`, and `ruff check`.')).toEqual([
      'ollama run llama3.2',
      'express /tmp/foo',
      'ruff check',
    ]);
  });

  it('recognizes platform scripts and project-specific executable wrappers', () => {
    expect(cmdText(md(
      'Run `update.bat`, `webui.sh`, `bin/rails server`, and `vc env pull`.',
      fence('bash', 'yay -S python311', 'snap install hugo', 'openssl rand -base64 32'),
    ))).toEqual(['update.bat', 'webui.sh', 'bin/rails server', 'vc env pull', 'yay -S python311', 'snap install hugo', 'openssl rand -base64 32']);
  });

  it('recognizes PowerShell environment commands', () => {
    expect(cmdText(fence('powershell', '$env:DATABASE_URL="postgres://localhost/db"; $env:DATABASE_DIRECT_URL="postgres://localhost/db"'))).toEqual([
      '$env:DATABASE_URL="postgres://localhost/db"; $env:DATABASE_DIRECT_URL="postgres://localhost/db"',
    ]);
  });

  it('normalizes unambiguous command wrappers', () => {
    expect(cmdText(md(
      'Use `python -m pip install rich`.',
      fence('bash', 'python -m pip install requests', 'npx create-expo-app@latest'),
    ))).toEqual(['pip install rich', 'pip install requests', 'npx create-expo-app']);
  });

  it('recognizes documented standalone tool commands in inline code', () => {
    expect(cmdText('Run `strip` on the binary.')).toEqual(['strip']);
  });

  it('flags risky commands', () => {
    const list = commands(fence('bash', 'curl -fsSL https://x.sh | sh', 'rm -rf node_modules', 'chmod 777 data', 'npm test'));
    expect(list.map((c) => c.risky)).toEqual([true, true, true, false]);
  });

  it('never throws on empty or odd input', () => {
    expect(cmdText('')).toEqual([]);
    expect(cmdText(fence('bash', '', '   ', '\\'))).toEqual([]);
  });
});

describe('categorizeCommand', () => {
  it.each([
    ['npm install', 'setup'],
    ['npm i', 'setup'],
    ['pip install -r requirements.txt', 'setup'],
    ['git clone https://github.com/a/b', 'setup'],
    ['cp .env.example .env', 'setup'],
    ['poetry install', 'setup'],
    ['python -m venv .venv', 'setup'],
    ['npm run dev', 'dev'],
    ['yarn dev', 'dev'],
    ['npm start', 'dev'],
    ['python manage.py runserver', 'dev'],
    ['uvicorn main:app --reload', 'dev'],
    ['cargo run', 'dev'],
    ['npm run build', 'build'],
    ['mvn package', 'build'],
    ['npm test', 'test'],
    ['pytest -q', 'test'],
    ['npx vitest run', 'test'],
    ['cargo test', 'test'],
    ['npm run lint', 'lint'],
    ['npx prettier --write .', 'lint'],
    ['ruff check .', 'lint'],
    ['docker compose up -d', 'docker'],
    ['docker-compose logs -f', 'docker'],
    ['npx prisma migrate dev', 'database'],
    ['python manage.py migrate', 'database'],
    ['alembic upgrade head', 'database'],
    ['vercel --prod', 'deploy'],
    ['fly deploy', 'deploy'],
    ['kubectl apply -f k8s/', 'deploy'],
    ['terraform apply', 'deploy'],
    ['cd my-app', 'other'],
    ['python main.py', 'other'],
  ])('%s -> %s', (cmd, expected) => {
    expect(categorizeCommand(cmd)).toBe(expected);
  });

  it('cargo build is setup only under Installation', () => {
    expect(categorizeCommand('cargo build --release', 'installation')).toBe('setup');
    expect(categorizeCommand('cargo build --release', 'usage')).toBe('build');
  });
});

describe('command helpers', () => {
  it('isCommandLine uses known prefixes', () => {
    expect(isCommandLine('npx create-next-app')).toBe(true);
    expect(isCommandLine('./gradlew build')).toBe(true);
    expect(isCommandLine('Hello world')).toBe(false);
    expect(isCommandLine('')).toBe(false);
  });

  it('joinContinuations handles \\, ^ and `', () => {
    expect(joinContinuations(['a \\', 'b'])).toEqual(['a b']);
    expect(joinContinuations(['a ^', 'b'])).toEqual(['a b']);
    expect(joinContinuations(['a `', 'b'])).toEqual(['a b']);
  });

  it('parseCommandLines returns offsets', () => {
    expect(parseCommandLines('# c\nnpm i\n\nnpm test')).toEqual([
      { command: 'npm i', offset: 1 },
      { command: 'npm test', offset: 3 },
    ]);
  });

  it('commandLineRatio', () => {
    expect(commandLineRatio('npm i\nfoo')).toBe(0.5);
    expect(commandLineRatio('')).toBe(0);
  });

  it('stripPrompt', () => {
    expect(stripPrompt('$ ls')).toBe('ls');
    expect(stripPrompt('C:\\app> npm start')).toBe('npm start');
  });

  it('isInlineCommand needs two tokens and a known prefix', () => {
    expect(isInlineCommand('npm install')).toBe(true);
    expect(isInlineCommand('npm')).toBe(false);
    expect(isInlineCommand('useState hook')).toBe(false);
  });

  it('isRiskyCommand', () => {
    expect(isRiskyCommand('wget -qO- https://x | bash')).toBe(true);
    expect(isRiskyCommand('sudo npm i -g x')).toBe(true);
    expect(isRiskyCommand('rm -fr build')).toBe(true);
    expect(isRiskyCommand('npm run build')).toBe(false);
  });
});
