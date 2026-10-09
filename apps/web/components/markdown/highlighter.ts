import type { HighlighterCore } from 'shiki/core';

/**
 * Lazy Shiki highlighter (F-11). Loaded on first use, in the browser only.
 * Uses the JavaScript regex engine (no WebAssembly), so the CSP does not need
 * 'wasm-unsafe-eval'. Dual themes are emitted as CSS variables and switched by
 * data-theme in globals.css, so code follows the app theme without re-highlighting.
 */

let highlighterPromise: Promise<HighlighterCore> | null = null;

const LANG_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  terminal: 'bash',
  console: 'shellsession',
  'shell-session': 'shellsession',
  'sh-session': 'shellsession',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  cmd: 'bat',
  batch: 'bat',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  yml: 'yaml',
  env: 'dotenv',
  '.env': 'dotenv',
  docker: 'dockerfile',
  md: 'markdown',
  htm: 'html',
  gql: 'graphql',
  tf: 'hcl',
  terraform: 'hcl',
  conf: 'ini',
  properties: 'ini',
  patch: 'diff',
  jsonc: 'jsonc',
};

export function normalizeLang(lang: string | null | undefined): string {
  const l = (lang ?? '').toLowerCase().trim();
  return LANG_ALIASES[l] ?? l;
}

export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [
          import('shiki/langs/bash.mjs'),
          import('shiki/langs/shellsession.mjs'),
          import('shiki/langs/powershell.mjs'),
          import('shiki/langs/bat.mjs'),
          import('shiki/langs/javascript.mjs'),
          import('shiki/langs/typescript.mjs'),
          import('shiki/langs/jsx.mjs'),
          import('shiki/langs/tsx.mjs'),
          import('shiki/langs/json.mjs'),
          import('shiki/langs/jsonc.mjs'),
          import('shiki/langs/yaml.mjs'),
          import('shiki/langs/toml.mjs'),
          import('shiki/langs/ini.mjs'),
          import('shiki/langs/dotenv.mjs'),
          import('shiki/langs/python.mjs'),
          import('shiki/langs/go.mjs'),
          import('shiki/langs/rust.mjs'),
          import('shiki/langs/java.mjs'),
          import('shiki/langs/kotlin.mjs'),
          import('shiki/langs/swift.mjs'),
          import('shiki/langs/c.mjs'),
          import('shiki/langs/cpp.mjs'),
          import('shiki/langs/csharp.mjs'),
          import('shiki/langs/php.mjs'),
          import('shiki/langs/ruby.mjs'),
          import('shiki/langs/sql.mjs'),
          import('shiki/langs/html.mjs'),
          import('shiki/langs/css.mjs'),
          import('shiki/langs/scss.mjs'),
          import('shiki/langs/markdown.mjs'),
          import('shiki/langs/dockerfile.mjs'),
          import('shiki/langs/diff.mjs'),
          import('shiki/langs/graphql.mjs'),
          import('shiki/langs/xml.mjs'),
          import('shiki/langs/dart.mjs'),
          import('shiki/langs/hcl.mjs'),
          import('shiki/langs/http.mjs'),
          import('shiki/langs/vue.mjs'),
          import('shiki/langs/svelte.mjs'),
          import('shiki/langs/make.mjs'),
        ],
        engine: createJavaScriptRegexEngine(),
      });
    })();
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

/** Highlight code to HTML. Returns null if the language is unknown or highlighting fails. */
export async function highlight(code: string, lang: string | null | undefined): Promise<string | null> {
  const normalized = normalizeLang(lang);
  if (!normalized || normalized === 'text' || normalized === 'plaintext' || normalized === 'txt') return null;
  try {
    const hl = await getHighlighter();
    if (!hl.getLoadedLanguages().includes(normalized)) return null;
    return hl.codeToHtml(code, {
      lang: normalized,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
