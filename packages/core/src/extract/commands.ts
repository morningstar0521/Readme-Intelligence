import type { Code, InlineCode, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';
import type { CommandCategory, CommandItem, SectionType } from '../types';
import type { Block, DocContext } from './context';
import { refFor } from './context';

/**
 * Commands extractor (Extractor spec 4.4).
 * Sources: fenced code blocks (shell languages, or unlabeled blocks where most lines are
 * commands) and inline code that starts with a known command prefix.
 * Commands are never run and never judged safe or unsafe; `risky` only drives a warning icon.
 */

export const SHELL_LANGS = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'console',
  'terminal',
  'shellsession',
  'shell-session',
  'sh-session',
  'powershell',
  'ps',
  'ps1',
  'pwsh',
  'cmd',
  'bat',
  'batch',
]);

/** Languages treated like "no language": checked with the majority rule. */
const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plaintext', 'plain']);

export const COMMAND_PREFIXES = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'pnpx', 'bun', 'bunx', 'node', 'deno',
  'pip', 'pip3', 'pipx', 'python', 'python3', 'py', 'poetry', 'uv', 'uvx', 'conda', 'mamba',
  'cargo', 'rustup', 'go', 'mvn', 'gradle', './gradlew', 'gradlew', './mvnw', 'mvnw', 'dotnet',
  'docker', 'docker-compose', 'podman', 'make', 'cmake', 'git', 'gh', 'cd', 'cp', 'mv', 'mkdir',
  'source', 'export', 'chmod', 'curl', 'wget', 'brew', 'apt', 'apt-get', 'sudo', 'flutter', 'dart',
  'php', 'composer', 'bundle', 'rails', 'ruby', 'gem', 'rake', 'java', 'kubectl', 'helm', 'terraform',
  'prisma', 'alembic', 'pytest', 'jest', 'vitest', 'tox', 'nox', 'uvicorn', 'gunicorn', 'flask',
  'django-admin', 'vercel', 'netlify', 'fly', 'flyctl', 'heroku', 'firebase', 'supabase', 'wrangler',
  'serverless', 'sls', 'aws', 'gcloud', 'az', 'nvm', 'corepack', 'turbo', 'nx', 'lerna', 'tsc',
  'eslint', 'prettier', 'ruff', 'black', 'mypy', 'expo', 'ng', 'vue', 'nest', 'mix', 'swift', 'xcodebuild',
  'pod', 'cabal', 'sbt', 'lein', 'zig', 'nix', 'bazel', 'ansible-playbook',
  'rm', 'tar', 'unzip', 'ssh', 'scp', 'psql', 'mysql', 'redis-cli', 'mongosh', 'ollama',
  'strip', 'choco', 'scoop', 'winget', 'nix-env', 'flox', 'guix', 'pkg_add', 'pkgin', 'pkgman',
  'xbps-install', 'dnf', 'emerge', 'apk', 'pacman', 'port', 'pkg', 'yay', 'doas', 'snap', 'openssl', 'echo',
  'vc', 'createDB',
  // Common project CLIs that frequently appear in README usage examples.
  'rg', 'bat', 'fzf', 'whisper', 'streamlit', 'express', 'gitea', 'hugo', 'ruff', 'ruff',
  'terraform', 'helm', 'kind', 'minikube', 'just', 'mise', 'firebase', 'supabase',
]);

const PROMPT_RE = /^(?:\$|%|>|PS>|PS [^>]{0,80}>|[A-Za-z]:\\[^>]{0,120}>)\s+/;

/** Strip a shell prompt prefix ("$ ", "> ", "PS> ", "C:\\path> "). */
export function stripPrompt(line: string): string {
  return line.replace(PROMPT_RE, '');
}

function isCommentLine(line: string): boolean {
  return /^(#|\/\/|::|rem\s|REM\s)/.test(line) || line === 'REM' || line === '#';
}

/** Remove a trailing " # comment" when the line has no quotes (to avoid cutting strings). */
function stripTrailingComment(line: string): string {
  if (/["'`]/.test(line)) return line;
  const idx = line.search(/\s+#/);
  return idx === -1 ? line : line.slice(0, idx).trimEnd();
}

/** First "real" token after optional `sudo` and `VAR=value` prefixes. */
function commandToken(line: string): string | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(tokens[i]!)) i++;
  const tok = tokens[i];
  return tok ?? null;
}

/** True if the line starts with a known command prefix. */
export function isCommandLine(line: string): boolean {
  if (/^\$env[:.]/i.test(line.trim())) return true;
  const tok = commandToken(line);
  if (!tok) return false;
  if (COMMAND_PREFIXES.has(tok) || COMMAND_PREFIXES.has(tok.toLowerCase())) return true;
  // Project-local executables are commonly documented as ./bin/tool or ./tool.
  return /^(?:(?:\.\/|~\/)[A-Za-z0-9][A-Za-z0-9._/-]*|(?:bin\/)?[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:sh|bash|bat|cmd)|bin\/[A-Za-z0-9][A-Za-z0-9._/-]*)(?:\s|$)/.test(line);
}

/** Join continued lines ending with "\" (sh), "^" (cmd) or "`" (PowerShell). */
export function joinContinuations(lines: string[]): string[] {
  const out: string[] = [];
  let buffer = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/(?:\\|\^|`)$/.test(line) && !/\\\\$/.test(line)) {
      buffer += line.slice(0, -1).trimEnd() + ' ';
      continue;
    }
    buffer += buffer ? line.trimStart() : line;
    out.push(buffer);
    buffer = '';
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/** Normalise whitespace inside a command. */
export function normalizeCommand(cmd: string): string {
  let normalized = cmd.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/^(?:python3?|py)\s+-m\s+pip\b/i, 'pip');
  normalized = normalized.replace(/^(npx\s+\S+)@latest\b/i, '$1');
  return normalized;
}

/**
 * Parse the lines of a code block into commands.
 * Returns the command text and its 0-based line offset inside the block.
 */
export function parseCommandLines(value: string): { command: string; offset: number }[] {
  const rawLines = value.split('\n');
  // Track original offsets through continuation joining.
  const results: { command: string; offset: number }[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const start = i;
    const group: string[] = [rawLines[i]!];
    while (/(?:\\|\^|`)\s*$/.test(rawLines[i]!) && !/\\\\\s*$/.test(rawLines[i]!) && i + 1 < rawLines.length) {
      i++;
      group.push(rawLines[i]!);
    }
    i++;
    const joined = joinContinuations(group)[0] ?? '';
    let line = joined.trim();
    if (!line) continue;
    line = stripPrompt(line).trim();
    if (!line || isCommentLine(line)) continue;
    line = stripTrailingComment(line);
    if (!line) continue;
    if (!isCommandLine(line)) continue;
    results.push({ command: normalizeCommand(line), offset: start });
  }
  return results;
}

/** Share of non-empty, non-comment lines that look like commands (0..1). */
export function commandLineRatio(value: string): number {
  let total = 0;
  let commands = 0;
  for (const raw of joinContinuations(value.split('\n'))) {
    const line = stripPrompt(raw.trim()).trim();
    if (!line || isCommentLine(line)) continue;
    total++;
    if (isCommandLine(stripTrailingComment(line))) commands++;
  }
  return total === 0 ? 0 : commands / total;
}

/** Should this code block be scanned for commands? */
export function isCommandBlock(code: Code): boolean {
  const lang = (code.lang ?? '').toLowerCase().trim();
  if (SHELL_LANGS.has(lang)) return true;
  if (PLAIN_LANGS.has(lang)) return commandLineRatio(code.value) > 0.5;
  return false;
}

const RISKY_RE = /\bsudo\b|\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bcurl\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\bwget\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\bchmod\s+(?:-R\s+)?777\b/i;

export function isRiskyCommand(cmd: string): boolean {
  return RISKY_RE.test(cmd);
}

/** Category rules, first match wins (spec order: setup, dev, build, test, lint, docker, database, deploy). */
export function categorizeCommand(command: string, section: SectionType | null = null): CommandCategory {
  const c = command.toLowerCase().replace(/^sudo\s+/, '');
  const setup =
    /\binstall\b|\bnpm i\b|\bnpm ci\b|\bpnpm i\b|\bbun i\b|^yarn$|^yarn --frozen-lockfile|\bgit clone\b|\bcp \.env|\bcp \S*\.env\S*|\bpoetry install\b|\bbundle install\b|\bcomposer install\b|\buv sync\b|\bgo mod (download|tidy)\b|\bgo get\b|-m venv\b|\bvirtualenv\b|\bconda (create|env create)\b|\bsource \S*activate\b/;
  if (setup.test(c)) return 'setup';
  if (/^cargo build\b/.test(c) && section === 'installation') return 'setup';
  const dev =
    /\brun dev\b|\b(yarn|pnpm|bun) dev\b|\bstart\b|\bserve\b|\brunserver\b|\buvicorn\b|\bflask run\b|\bcargo run\b|\bnext dev\b|\bgo run\b|\bnodemon\b|\bstart:dev\b/;
  if (dev.test(c)) return 'dev';
  if (/\bbuild\b|\bcompile\b|\bpackage\b/.test(c)) return 'build';
  if (/\btest\b|\btests\b|\btest:\S+|\bpytest\b|\bjest\b|\bvitest\b|\bcargo test\b|\bgo test\b|\btox\b/.test(c)) return 'test';
  if (/\blint\b|\blint:\S+|\bformat\b|\bprettier\b|\beslint\b|\bruff\b|\bblack\b|\bfmt\b|\bclippy\b|\bmypy\b/.test(c)) return 'lint';
  if (/^(docker|docker-compose|podman)\b/.test(c)) return 'docker';
  if (/\bmigrate\b|\bmigration\b|\bmigrations\b|\bmakemigrations\b|\bprisma\b|\bseed\b|\balembic\b|\bpsql\b/.test(c)) return 'database';
  if (/\bdeploy\b|^vercel\b|^netlify\b|^(fly|flyctl)\b|\bkubectl apply\b|\bhelm (install|upgrade)\b|\bterraform apply\b|^heroku\b|^firebase deploy\b|^wrangler (deploy|publish)\b/.test(c)) return 'deploy';
  return 'other';
}

function pushCommand(
  out: CommandItem[],
  seen: Set<string>,
  command: string,
  language: string | null,
  block: Block,
  line: number
): void {
  const key = normalizeCommand(command);
  if (!key || seen.has(key)) return;
  seen.add(key);
  const source = refFor(block);
  source.line = line || block.line;
  out.push({
    command: key,
    category: categorizeCommand(key, block.section),
    language,
    source,
    risky: isRiskyCommand(key),
  });
}

/** Inline code that looks like a command: known prefix and at least two tokens. */
export function isInlineCommand(value: string): boolean {
  const v = stripPrompt(value.trim());
  if (!v || v.length > 200 || v.includes('\n')) return false;
  if (v.split(/\s+/).length < 2) return /\.(?:sh|bash|bat|cmd)$/i.test(v) && isCommandLine(v);
  return isCommandLine(v);
}

/** Commands found in one node (used by the install-steps extractor as well). */
export function commandsInNode(node: RootContent): { command: string; line: number; language: string | null }[] {
  const out: { command: string; line: number; language: string | null }[] = [];
  const visitCode = (code: Code) => {
    if (!isCommandBlock(code)) return;
    // Code content starts on the line after the opening fence.
    const firstLine = (code.position?.start.line ?? 0) + 1;
    const lang = code.lang ? code.lang.toLowerCase() : null;
    for (const { command, offset } of parseCommandLines(code.value)) {
      out.push({ command, line: firstLine + offset, language: lang && SHELL_LANGS.has(lang) ? lang : null });
    }
  };
  if (node.type === 'code') {
    visitCode(node);
    return out;
  }
  visit(node, (n) => {
    if (n.type === 'code') visitCode(n as Code);
    else if (n.type === 'inlineCode') {
      const ic = n as InlineCode;
      if (isInlineCommand(ic.value)) {
        out.push({ command: normalizeCommand(stripPrompt(ic.value.trim())), line: ic.position?.start.line ?? 0, language: null });
      }
    }
  });
  return out;
}

export function extractCommands(ctx: DocContext): CommandItem[] {
  const out: CommandItem[] = [];
  const seen = new Set<string>();
  for (const block of ctx.blocks) {
    if (block.isHeading) continue;
    for (const found of commandsInNode(block.node)) {
      pushCommand(out, seen, found.command, found.language, block, found.line);
    }
  }
  return out;
}
