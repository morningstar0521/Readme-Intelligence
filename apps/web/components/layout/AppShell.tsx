'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { TriangleAlert } from 'lucide-react';
import {
  checkRepository,
  exportIntelligenceJson,
  type AnalysisResult,
  type SearchEntry,
} from '@readme-intel/core';
import { TopBar } from './TopBar';
import { LeftSidebar } from './LeftSidebar';
import { RightPanel } from './RightPanel';
import { Drawer } from './Drawer';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { CommandPalette } from '@/components/search/CommandPalette';
import { ShortcutsModal } from '@/components/common/ShortcutsModal';
import {
  JumpContext,
  findAnchor,
  findElementForLine,
  scrollToElement,
  type JumpApi,
} from '@/lib/jump';
import { useHotkeys, useMediaQuery } from '@/lib/hooks';
import { usePersistentState } from '@/lib/storage';
import { loadRepoSnapshot } from '@/lib/loadRepo';
import type { RealityState } from '@/components/intelligence/RealityCheck';

/**
 * Three-panel viewer (UI spec 7.1):
 * - >= 1024 px: contents | README | intelligence, side panels collapsible (Cmd/Ctrl+B, Cmd/Ctrl+Shift+B).
 * - 640-1023 px: README full width, panels open as drawers.
 * - < 640 px: single column with a Readme / Intelligence tab switch.
 */
export function AppShell({ analysis }: { analysis: AnalysisResult }) {
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const isPhone = useMediaQuery('(max-width: 639px)', false);
  const [leftOpen, setLeftOpen] = usePersistentState('rid-left-open', z.boolean(), true);
  const [rightOpen, setRightOpen] = usePersistentState('rid-right-open', z.boolean(), true);
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);
  const [tab, setTab] = useState<'readme' | 'intel'>('readme');
  const [viewMode, setViewMode] = usePersistentState(
    'rid-view-mode',
    z.enum(['reader', 'overview']),
    'reader'
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Reality check state lives here so it survives drawers and tab switches.
  const [reality, setReality] = useState<RealityState>({ status: 'idle' });
  const runReality = useCallback(async () => {
    const source = analysis.source;
    if (source.kind !== 'github') return;
    setReality({ status: 'loading' });
    const res = await loadRepoSnapshot(source);
    if (!res.ok) {
      setReality({ status: 'error', code: res.code, resetAt: res.resetAt });
      return;
    }
    try {
      const report = checkRepository(
        { intelligence: analysis.intelligence, hast: analysis.hast },
        res.snapshot
      );
      setReality({ status: 'ready', report, skipped: res.skipped });
    } catch {
      setReality({ status: 'error', code: 'UNKNOWN', resetAt: null });
    }
  }, [analysis]);
  const contentRef = useRef<HTMLDivElement>(null);

  // On the phone tab layout the README must be visible before we can scroll to a line.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const ensureReadmeVisible = useCallback(
    (then: () => void) => {
      setDrawer(null);
      const needsReader = viewModeRef.current !== 'reader';
      if (needsReader) setViewMode('reader');
      if (needsReader || tabRef.current !== 'readme') {
        setTab('readme');
        window.setTimeout(then, 50);
      } else {
        window.requestAnimationFrame(then);
      }
    },
    [setViewMode]
  );

  const jump: JumpApi = useMemo(
    () => ({
      jumpToLine: (line: number) =>
        ensureReadmeVisible(() => {
          const container = contentRef.current;
          if (!container) return;
          const el = findElementForLine(container, line);
          if (el) scrollToElement(el);
        }),
      jumpToAnchor: (id: string) =>
        ensureReadmeVisible(() => {
          const el = findAnchor(id);
          if (el) {
            scrollToElement(el, false);
            try {
              window.history.replaceState(null, '', `#${encodeURIComponent(el.id)}`);
            } catch {
              /* ignore */
            }
          }
        }),
    }),
    [ensureReadmeVisible]
  );

  const toggleLeft = useCallback(() => {
    if (isDesktop) setLeftOpen((v) => !v);
    else setDrawer((d) => (d === 'left' ? null : 'left'));
  }, [isDesktop, setLeftOpen]);

  const toggleRight = useCallback(() => {
    if (isDesktop) setRightOpen((v) => !v);
    else if (isPhone) setTab((t) => (t === 'intel' ? 'readme' : 'intel'));
    else setDrawer((d) => (d === 'right' ? null : 'right'));
  }, [isDesktop, isPhone, setRightOpen]);

  useHotkeys([
    { key: 'k', mod: true, allowInInput: true, handler: () => setSearchOpen((o) => !o) },
    { key: 'b', mod: true, handler: toggleLeft },
    { key: 'b', mod: true, shift: true, handler: toggleRight },
    { key: '?', shift: true, handler: () => setShortcutsOpen(true) },
  ]);

  const onSelect = useCallback(
    (entry: SearchEntry) => {
      if (entry.kind === 'section' && entry.anchor) jump.jumpToAnchor(entry.anchor);
      else jump.jumpToLine(entry.line);
    },
    [jump]
  );

  const exportJson = useCallback(() => {
    const base = JSON.parse(exportIntelligenceJson(analysis)) as Record<string, unknown>;
    if (reality.status === 'ready') {
      const { claims, counts, readiness, snapshot } = reality.report;
      base.realityCheck = { snapshot, counts, readiness, claims };
    }
    return JSON.stringify(base, null, 2);
  }, [analysis, reality]);
  const name = analysis.intelligence.project.name?.value ?? null;

  const readme = (
    <div ref={contentRef} className="mx-auto w-full max-w-content px-4 py-6 sm:px-6">
      {analysis.warnings.length > 0 && (
        <div
          role="status"
          className="mb-4 flex gap-2 rounded-card border border-border bg-warning-soft p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <ul className="space-y-0.5">
            {analysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <MarkdownView hast={analysis.hast} />
    </div>
  );

  const left = (
    <LeftSidebar
      toc={analysis.toc}
      sections={analysis.sections}
      onNavigate={() => setDrawer(null)}
    />
  );
  const right = <RightPanel analysis={analysis} reality={reality} onRunReality={runReality} />;
  const overview = (
    <RightPanel
      analysis={analysis}
      reality={reality}
      onRunReality={runReality}
      variant="overview"
    />
  );

  return (
    <JumpContext.Provider value={jump}>
      <div className="app-surface min-h-screen">
        <a
          href="#readme-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-btn focus:bg-accent focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to README
        </a>
        <TopBar
          projectName={name}
          source={analysis.source}
          leftOpen={isDesktop ? leftOpen : drawer === 'left'}
          rightOpen={isDesktop ? rightOpen : isPhone ? tab === 'intel' : drawer === 'right'}
          onToggleLeft={toggleLeft}
          onToggleRight={toggleRight}
          onSearch={() => setSearchOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          exportJson={exportJson}
          showPanelToggles
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {isPhone && (
          <div
            role="tablist"
            aria-label="View"
            className="sticky top-14 z-20 flex border-b border-border bg-bg"
          >
            {(['readme', 'intel'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-[color:var(--link)] text-fg' : 'text-fg-2'}`}
              >
                {t === 'readme' ? 'Readme' : 'Intelligence'}
              </button>
            ))}
          </div>
        )}

        {isDesktop && viewMode === 'overview' ? (
          <main
            id="intelligence-overview"
            className="mx-auto min-w-0 max-w-[1600px] px-4 py-5 outline-none sm:px-6 lg:px-8"
          >
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">repository overview</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                  Project intelligence
                </h2>
                <p className="mt-1 text-sm text-fg-2">
                  Extracted facts, setup signals, and evidence from this README.
                </p>
              </div>
              <p className="hidden font-mono text-[11px] text-fg-2 sm:block">
                {analysis.source.kind === 'github'
                  ? 'github source'
                  : `${analysis.source.kind} source`}
              </p>
            </div>
            {overview}
          </main>
        ) : isDesktop ? (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `${leftOpen ? '260px' : '0px'} minmax(0, 1fr) ${rightOpen ? '400px' : '0px'}`,
            }}
          >
            <aside
              aria-label="Contents"
              className={`thin-scroll sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-border p-3 ${leftOpen ? '' : 'invisible'}`}
            >
              {leftOpen && left}
            </aside>
            <main id="readme-content" tabIndex={-1} className="min-w-0 outline-none">
              {readme}
            </main>
            <aside
              aria-label="Intelligence"
              className={`thin-scroll sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-l border-border p-3 ${rightOpen ? '' : 'invisible'}`}
            >
              {rightOpen && right}
            </aside>
          </div>
        ) : (
          <>
            <main
              id="readme-content"
              tabIndex={-1}
              className={`min-w-0 outline-none ${isPhone && tab !== 'readme' ? 'hidden' : ''}`}
            >
              {readme}
            </main>
            {isPhone && tab === 'intel' && (
              <aside aria-label="Intelligence" className="p-3">
                {right}
              </aside>
            )}
            <Drawer
              open={drawer === 'left'}
              side="left"
              title="Contents"
              onClose={() => setDrawer(null)}
            >
              {left}
            </Drawer>
            {!isPhone && (
              <Drawer
                open={drawer === 'right'}
                side="right"
                title="Intelligence"
                onClose={() => setDrawer(null)}
              >
                {right}
              </Drawer>
            )}
          </>
        )}

        <CommandPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          entries={analysis.searchIndex}
          onSelect={onSelect}
        />
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </JumpContext.Provider>
  );
}
