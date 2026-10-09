'use client';

import { Link2 } from 'lucide-react';
import type { LinkItem, LinkType } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';

const ORDER: LinkType[] = ['repo', 'demo', 'docs', 'video', 'issues', 'chat', 'license', 'other'];
const LABELS: Record<LinkType, string> = {
  repo: 'Repository',
  demo: 'Demo',
  docs: 'Docs',
  video: 'Video',
  issues: 'Issues',
  chat: 'Chat',
  license: 'License',
  other: 'Other',
};

/** Links grouped by type (F-38). */
export function LinksCard({ links }: { links: LinkItem[] }) {
  return (
    <Card id="links" title="Links" icon={Link2} count={links.length} defaultOpen={links.length <= 12}>
      {links.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {ORDER.map((type) => {
            const items = links.filter((l) => l.type === type);
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-2">{LABELS[type]}</p>
                <ul className="space-y-1">
                  {items.map((l) => (
                    <li key={l.url} className="flex items-start justify-between gap-2 text-sm">
                      <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-words text-link hover:underline" title={l.url}>
                        {l.text}
                      </a>
                      <SourceChip source={l.source} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
