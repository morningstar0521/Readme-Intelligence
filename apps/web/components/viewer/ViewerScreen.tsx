'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeReadme, type AnalysisResult, type AppErrorCode, type SourceInfo } from '@readme-intel/core';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState } from '@/components/common/ErrorState';
import { Logo } from '@/components/common/Logo';
import { loadGitHubReadme } from '@/lib/loadReadme';
import { loadDoc } from '@/lib/storage';
import { SAMPLE_README } from '@/lib/sampleReadme';

type State =
  | { status: 'loading' }
  | { status: 'error'; code: AppErrorCode; resetAt: string | null }
  | { status: 'missing' }
  | { status: 'ready'; markdown: string; source: SourceInfo };

interface ViewerScreenProps {
  /** GitHub URL / owner/repo to fetch through the proxy. */
  githubInput?: string | null;
  /** "local" or "paste" documents come from sessionStorage; "example" is the bundled sample. */
  mode?: 'github' | 'stored' | 'example';
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="flex h-14 items-center border-b border-border px-3">
        <Logo />
      </div>
      <div className="mx-auto max-w-content space-y-3 px-6 py-10">
        <p className="sr-only">Loading README</p>
        {[70, 95, 85, 60, 90, 40].map((w, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-surface" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ViewerScreen({ githubInput = null, mode = githubInput ? 'github' : 'stored' }: ViewerScreenProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode === 'example') {
      setState({ status: 'ready', markdown: SAMPLE_README, source: { kind: 'local', fileName: 'example-README.md' } });
      return;
    }
    if (mode === 'stored' || !githubInput) {
      const doc = loadDoc();
      setState(doc ? { status: 'ready', markdown: doc.markdown, source: doc.source } : { status: 'missing' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadGitHubReadme(githubInput, controller.signal)
      .then((res) => {
        if (res.ok) setState({ status: 'ready', markdown: res.markdown, source: res.source });
        else setState({ status: 'error', code: res.code, resetAt: res.resetAt });
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') setState({ status: 'error', code: 'NETWORK', resetAt: null });
      });
    return () => controller.abort();
  }, [githubInput, mode, attempt]);

  const analysis = useMemo<AnalysisResult | null>(() => {
    if (state.status !== 'ready') return null;
    try {
      return analyzeReadme(state.markdown, state.source);
    } catch {
      return null;
    }
  }, [state]);

  useEffect(() => {
    const name = analysis?.intelligence.project.name?.value;
    document.title = name ? `${name} · README Intelligence` : 'README Intelligence Viewer';
  }, [analysis]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (state.status === 'loading') return <LoadingSkeleton />;
  if (state.status === 'missing') {
    return (
      <ErrorState
        title="Nothing to show"
        message="There is no README loaded in this tab. Local files and pasted Markdown stay in this browser tab only."
        causes={['The page was opened in a new tab or the session ended.', 'Browser storage is blocked for this site.']}
      />
    );
  }
  if (state.status === 'error') return <ErrorState code={state.code} resetAt={state.resetAt} onRetry={retry} />;
  if (!analysis) return <ErrorState code="PARSE_FAILURE" />;
  return <AppShell analysis={analysis} />;
}
