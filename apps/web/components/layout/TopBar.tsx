'use client';

import {
  Search,
  PanelLeft,
  PanelRight,
  Keyboard,
  FileJson,
  Github,
  FileText,
  ClipboardPaste,
  Check,
  BookOpen,
  LayoutDashboard,
} from 'lucide-react';
import { useState } from 'react';
import type { SourceInfo } from '@readme-intel/core';
import { Logo } from '@/components/common/Logo';
import { SettingsMenu } from '@/components/common/SettingsMenu';
import { useIsMac, copyText } from '@/lib/hooks';

interface TopBarProps {
  projectName: string | null;
  source: SourceInfo;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSearch: () => void;
  onShortcuts: () => void;
  exportJson: () => string;
  showPanelToggles: boolean;
  viewMode: 'reader' | 'overview';
  onViewModeChange: (mode: 'reader' | 'overview') => void;
}

/** Source indicator (F-61): GitHub, Local or Pasted. */
export function SourceBadge({ source }: { source: SourceInfo }) {
  if (source.kind === 'github') {
    return (
      <a
        href={source.htmlUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex min-w-0 items-center gap-1 rounded-btn border border-border px-2 py-1 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        title={`GitHub: ${source.owner}/${source.repo}@${source.ref}/${source.path}`}
        data-testid="source-badge"
      >
        <Github className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">GitHub</span>
        <span className="hidden truncate md:inline">
          · {source.owner}/{source.repo}
        </span>
      </a>
    );
  }
  const Icon = source.kind === 'local' ? FileText : ClipboardPaste;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-btn border border-border px-2 py-1 text-xs text-fg-2"
      data-testid="source-badge"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{source.kind === 'local' ? 'Local' : 'Pasted'}</span>
      {source.kind === 'local' && (
        <span className="hidden max-w-[12rem] truncate md:inline">· {source.fileName}</span>
      )}
    </span>
  );
}

export function TopBar(props: TopBarProps) {
  const mac = useIsMac();
  const [exported, setExported] = useState(false);
  const iconBtn = 'rounded-btn p-2 text-fg-2 transition-colors hover:bg-hover hover:text-fg';

  const onExport = async () => {
    if (await copyText(props.exportJson())) {
      setExported(true);
      window.setTimeout(() => setExported(false), 1500);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] shadow-[0_1px_0_color-mix(in_srgb,var(--accent)_16%,transparent)] backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3">
        {props.showPanelToggles && (
          <button
            type="button"
            onClick={props.onToggleLeft}
            aria-label="Toggle contents panel"
            aria-pressed={props.leftOpen}
            className={iconBtn}
            title="Contents"
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <Logo />
        <div className="min-w-0 border-l border-border pl-3">
          <p className="eyebrow hidden text-[10px] leading-none sm:block">evidence view</p>
          {props.projectName && (
            <h1 className="truncate text-sm font-semibold" title={props.projectName}>
              {props.projectName}
            </h1>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={props.onSearch}
            className="inline-flex items-center gap-2 rounded-btn border border-border px-2.5 py-1.5 text-sm text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            aria-label="Search"
            data-testid="search-button"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden rounded-[4px] border border-border px-1 font-mono text-[11px] md:inline">
              {mac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
          <SourceBadge source={props.source} />
          <div
            className="hidden items-center rounded-btn border border-border p-0.5 md:flex"
            role="group"
            aria-label="Layout view"
          >
            <button
              type="button"
              onClick={() => props.onViewModeChange('reader')}
              aria-pressed={props.viewMode === 'reader'}
              aria-label="Reader view"
              className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs transition-colors ${props.viewMode === 'reader' ? 'bg-hover font-medium text-fg' : 'text-fg-2 hover:text-fg'}`}
              title="Reader view"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden lg:inline">Reader</span>
            </button>
            <button
              type="button"
              onClick={() => props.onViewModeChange('overview')}
              aria-pressed={props.viewMode === 'overview'}
              aria-label="Full-screen overview"
              className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs transition-colors ${props.viewMode === 'overview' ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:text-fg'}`}
              title="Full-screen overview"
            >
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden lg:inline">Overview</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onExport}
            aria-label="Copy intelligence as JSON"
            title="Copy as JSON"
            className={iconBtn}
            data-testid="export-json"
          >
            {exported ? (
              <Check className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <FileJson className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={props.onShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className={`${iconBtn} hidden sm:inline-flex`}
          >
            <Keyboard className="h-4 w-4" aria-hidden />
          </button>
          <SettingsMenu />
          {props.showPanelToggles && (
            <button
              type="button"
              onClick={props.onToggleRight}
              aria-label="Toggle intelligence panel"
              aria-pressed={props.rightOpen}
              className={iconBtn}
              title="Intelligence"
            >
              <PanelRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
