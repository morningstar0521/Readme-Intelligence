'use client';

import { ListChecks } from 'lucide-react';
import type { Intelligence } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { CopyButton } from '@/components/common/CopyButton';
import { EmptyState } from '@/components/common/EmptyState';

/** Prerequisites and ordered install steps (F-32). */
export function InstallCard({ intel }: { intel: Intelligence }) {
  const { prerequisites, installSteps } = intel;
  const inferred = installSteps.some((s) => s.confidence === 'inferred-rule');
  return (
    <Card id="install" title="Setup" icon={ListChecks} count={installSteps.length}>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-2">Prerequisites</p>
      {prerequisites.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-1 space-y-1">
          {prerequisites.map((p, i) => (
            <li key={`${p.value}-${i}`} className="flex items-start justify-between gap-2 text-sm">
              <span>{p.value}</span>
              <SourceChip source={p.source} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-fg-2">Install steps</p>
      {installSteps.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {inferred && (
            <p className="mt-1 rounded-btn bg-warning-soft px-2 py-1 text-xs text-fg">
              No installation section found. These setup commands were collected from elsewhere in the README (inferred by rule).
            </p>
          )}
          <ol className="mt-2 space-y-3">
            {installSteps.map((s) => (
              <li key={s.order} className="flex gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold">{s.order}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">{s.title ?? <span className="text-fg-2">Step {s.order}</span>}</p>
                    <SourceChip source={s.source} />
                  </div>
                  {s.commands.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {s.commands.map((c) => (
                        <li key={c} className="flex items-center gap-1 rounded-btn border border-border bg-bg py-0.5 pl-2 pr-0.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={c}>
                            {c}
                          </code>
                          <CopyButton text={c} label={`Copy ${c}`} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
