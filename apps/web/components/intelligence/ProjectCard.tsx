'use client';

import { BookOpen, ExternalLink } from 'lucide-react';
import type { Intelligence, SourceInfo } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';

/** Project card (F-30): name, one-line description, detected languages/frameworks, key links. */
export function ProjectCard({ intel, source }: { intel: Intelligence; source: SourceInfo }) {
  const { name, description, badges } = intel.project;
  const stack = intel.techStack.filter((t) => ['language', 'frontend', 'backend'].includes(t.category)).slice(0, 8);
  const keyLinks = intel.links.filter((l) => ['repo', 'demo', 'docs'].includes(l.type)).slice(0, 4);
  const repoUrl = source.kind === 'github' ? `https://github.com/${source.owner}/${source.repo}` : null;

  return (
    <Card id="project" title="Project" icon={BookOpen}>
      {name ? (
        <div className="flex items-start justify-between gap-2">
          <p className="text-base font-semibold leading-snug" data-testid="project-name">
            {name.value}
            {name.confidence === 'inferred-rule' && <span className="ml-2 align-middle text-xs font-normal text-fg-2">(from repository name)</span>}
          </p>
          <SourceChip source={name.source} />
        </div>
      ) : (
        <EmptyState text="Project name: Not found in README" />
      )}

      {description ? (
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <p className="text-sm leading-relaxed text-fg-2">{description.value}</p>
          <SourceChip source={description.source} />
        </div>
      ) : (
        <EmptyState text="Description: Not found in README" />
      )}

      {stack.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Detected languages and frameworks">
          {stack.map((t) => (
            <li key={t.name} className="rounded-btn border border-border bg-bg px-1.5 py-0.5 text-xs">
              {t.name}
            </li>
          ))}
        </ul>
      )}

      {(repoUrl || keyLinks.length > 0) && (
        <ul className="mt-3 space-y-1 text-sm">
          {repoUrl && !keyLinks.some((l) => l.url === repoUrl) && (
            <li>
              <a href={repoUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-link hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Repository
              </a>
            </li>
          )}
          {keyLinks.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-link hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> <span className="capitalize">{l.type}</span>: {l.text}
              </a>
            </li>
          ))}
        </ul>
      )}

      {badges.length > 0 && <p className="mt-3 text-xs text-fg-2">{badges.length} badge{badges.length === 1 ? '' : 's'} detected</p>}
    </Card>
  );
}
