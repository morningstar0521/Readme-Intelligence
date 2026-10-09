'use client';

import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Braces,
  ClipboardPaste,
  FileText,
  ScanSearch,
  ShieldCheck,
  Terminal,
  Upload,
} from 'lucide-react';
import {
  parseGitHubInput,
  INVALID_URL_MESSAGE,
  errorMessage,
  MAX_INPUT_BYTES,
} from '@readme-intel/core';
import { saveDoc } from '@/lib/storage';
import { Logo } from '@/components/common/Logo';
import { SettingsMenu } from '@/components/common/SettingsMenu';

const ACCEPTED = /\.(md|markdown|mdx|mdown|txt)$/i;
const SIGNALS = [
  [Terminal, 'Commands', 'Install, run, test and deploy commands with source lines.'],
  [Braces, 'Configuration', 'Environment variables with secrets masked in the interface.'],
  [ScanSearch, 'Evidence', 'Tech stack, APIs and health signals linked back to the README.'],
] as const;

/** Landing screen (UI spec 7.2): URL input, drop zone, paste toggle, example link. */
export function Landing() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const openUrl = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseGitHubInput(url);
    if (!parsed.ok) {
      setUrlError(INVALID_URL_MESSAGE);
      return;
    }
    setUrlError(null);
    router.push(`/view?url=${encodeURIComponent(url.trim())}`);
  };

  const openFile = async (file: File | undefined | null) => {
    if (!file) return;
    setFileError(null);
    if (!ACCEPTED.test(file.name)) {
      setFileError('Choose a Markdown file (.md, .markdown, .mdx or .txt).');
      return;
    }
    try {
      // Read in the browser only. The content is never uploaded.
      const text = await file.text();
      if (text.includes('\u0000')) throw new Error('binary');
      saveDoc({ markdown: text, source: { kind: 'local', fileName: file.name } });
      router.push('/view?src=local');
    } catch {
      setFileError(errorMessage('PARSE_FAILURE'));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void openFile(e.dataTransfer.files?.[0]);
  };

  const openPasted = () => {
    if (!pasted.trim()) return;
    saveDoc({ markdown: pasted, source: { kind: 'paste' } });
    router.push('/view?src=paste');
  };

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border bg-[color:color-mix(in_srgb,var(--bg)_94%,transparent)] px-4 backdrop-blur">
        <Logo />
        <SettingsMenu />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:gap-20">
          <section>
            <p className="eyebrow">README intelligence / local-first</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.04em] sm:text-5xl sm:leading-[1.08]">
              Turn documentation into a usable project map.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-fg-2 sm:text-lg">
              Render a README, then inspect its commands, environment variables, setup steps, stack,
              APIs and health signals. Every result stays tied to the source line that produced it.
            </p>

            <form onSubmit={openUrl} className="mt-8" noValidate>
              <label htmlFor="repo-url" className="eyebrow text-fg-2">
                Start with a GitHub URL
              </label>
              <div className="mt-2 flex gap-2 rounded-card border border-border bg-surface p-1.5 shadow-[0_10px_30px_color-mix(in_srgb,var(--bg)_24%,transparent)] focus-within:border-[color:var(--link)]">
                <input
                  id="repo-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  placeholder="github.com/owner/repository"
                  aria-invalid={urlError ? true : undefined}
                  aria-describedby={urlError ? 'url-error' : 'url-hint'}
                  className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-fg-2"
                  data-testid="url-input"
                />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-accent px-4 text-sm font-semibold text-white transition-transform hover:-translate-y-px hover:brightness-105"
                  data-testid="open-button"
                >
                  Inspect <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
              {urlError ? (
                <p
                  id="url-error"
                  role="alert"
                  className="mt-1.5 text-sm text-error"
                  data-testid="url-error"
                >
                  {urlError}
                </p>
              ) : (
                <p id="url-hint" className="mt-2 text-xs text-fg-2">
                  Repository, branch folder, README file, raw link or{' '}
                  <span className="font-mono">owner/repo</span>.
                </p>
              )}
            </form>

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') &&
                (e.preventDefault(), fileInput.current?.click())
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              aria-label="Choose or drop a Markdown file"
              className={`technical-grid mt-5 flex cursor-pointer items-center gap-3 rounded-card border border-dashed px-4 py-4 transition-colors ${
                dragging
                  ? 'border-[color:var(--link)] bg-accent-soft'
                  : 'border-border hover:border-[color:color-mix(in_srgb,var(--accent)_50%,var(--border))] hover:bg-hover'
              }`}
              data-testid="drop-zone"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-accent-soft">
                <Upload className="h-4 w-4 text-accent" aria-hidden />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-sm font-medium">
                  Drop a Markdown file or click to choose
                </span>
                <span className="mt-0.5 block text-xs text-fg-2">
                  Read in your browser. Nothing is uploaded. Up to{' '}
                  {Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB.
                </span>
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,.mdx,.mdown,.txt,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => void openFile(e.target.files?.[0])}
                data-testid="file-input"
              />
            </div>
            {fileError && (
              <p role="alert" className="mt-1.5 text-sm text-error">
                {fileError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => setPasteOpen((o) => !o)}
                aria-expanded={pasteOpen}
                aria-controls="paste-area"
                className="inline-flex items-center gap-1.5 font-medium text-link hover:underline"
                data-testid="paste-toggle"
              >
                <ClipboardPaste className="h-4 w-4" aria-hidden /> Paste Markdown
              </button>
              <button
                type="button"
                onClick={() => router.push('/view?src=example')}
                className="inline-flex items-center gap-1.5 font-medium text-link hover:underline"
                data-testid="example-link"
              >
                <FileText className="h-4 w-4" aria-hidden /> Try an example
              </button>
            </div>

            {pasteOpen && (
              <div id="paste-area" className="mt-3">
                <label htmlFor="paste-input" className="sr-only">
                  Markdown text
                </label>
                <textarea
                  id="paste-input"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={10}
                  placeholder={'# My project\n\n## Installation\n\n```bash\nnpm install\n```'}
                  className="w-full rounded-btn border border-border bg-surface p-3 font-mono text-sm outline-none transition-colors placeholder:text-fg-2 focus:border-[color:var(--link)]"
                  data-testid="paste-input"
                />
                <button
                  type="button"
                  onClick={openPasted}
                  disabled={!pasted.trim()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  data-testid="paste-submit"
                >
                  Render <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}

            <p className="mt-10 flex items-start gap-2 border-t border-border pt-5 text-xs leading-5 text-fg-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              No AI, no tracking, no accounts. Local files and pasted text never leave your browser;
              only GitHub links are fetched through this site.
            </p>
          </section>

          <aside className="technical-grid rounded-card border border-border bg-surface p-5 shadow-[0_18px_45px_color-mix(in_srgb,var(--bg)_28%,transparent)] lg:mt-8">
            <p className="eyebrow">What gets extracted</p>
            <div className="mt-5 space-y-4">
              {SIGNALS.map(([Icon, title, detail]) => (
                <div key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn border border-border bg-bg">
                    <Icon className="h-4 w-4 text-accent" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-fg-2">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <p className="font-mono text-[11px] text-fg-2">
                deterministic rules / no AI calls / source-linked output
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
