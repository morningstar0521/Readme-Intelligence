'use client';

import { useMemo } from 'react';
import type { SectionInfo, SectionType, TocItem } from '@readme-intel/core';
import { useJump } from '@/lib/jump';
import { useScrollSpy } from '@/lib/hooks';

const SECTION_LABELS: Record<SectionType, string> = {
  overview: 'Overview',
  features: 'Features',
  techstack: 'Tech stack',
  prerequisites: 'Prerequisites',
  installation: 'Installation',
  usage: 'Usage',
  configuration: 'Configuration',
  api: 'API',
  testing: 'Testing',
  deployment: 'Deployment',
  structure: 'Structure',
  contributing: 'Contributing',
  license: 'License',
  roadmap: 'Roadmap',
};

interface LeftSidebarProps {
  toc: TocItem[];
  sections: SectionInfo[];
  onNavigate?: () => void;
}

/** Table of contents with scroll spy (F-20, F-21) and the list of detected sections. */
export function LeftSidebar({ toc, sections, onNavigate }: LeftSidebarProps) {
  const { jumpToAnchor } = useJump();
  const ids = useMemo(() => toc.map((t) => t.id), [toc]);
  const active = useScrollSpy(ids);
  const minDepth = toc.reduce((m, t) => Math.min(m, t.depth), 4);

  const found = useMemo(() => {
    const seen = new Map<SectionType, SectionInfo>();
    for (const s of sections) if (s.ownType && !seen.has(s.ownType)) seen.set(s.ownType, s);
    return [...seen.entries()];
  }, [sections]);

  const go = (id: string) => {
    jumpToAnchor(id);
    onNavigate?.();
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Table of contents">
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-fg-2">Contents</p>
        {toc.length === 0 ? (
          <p className="px-2 text-sm text-fg-2">No headings</p>
        ) : (
          <ul className="space-y-0.5" data-testid="toc">
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.id);
                  }}
                  aria-current={active === item.id ? 'location' : undefined}
                  style={{ paddingLeft: `${(item.depth - minDepth) * 12 + 8}px` }}
                  className={`block truncate rounded-btn py-1 pr-2 text-sm transition-colors ${
                    active === item.id ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'
                  }`}
                  title={item.text}
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div>
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-fg-2">Sections found</p>
        {found.length === 0 ? (
          <p className="px-2 text-sm text-fg-2">No standard sections detected</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 px-2">
            {found.map(([type, s]) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => (s.anchor ? go(s.anchor) : undefined)}
                  className="rounded-btn border border-border px-1.5 py-0.5 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg"
                  title={`"${s.text}" (line ${s.line})`}
                >
                  {SECTION_LABELS[type]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
