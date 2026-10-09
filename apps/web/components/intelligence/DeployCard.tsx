'use client';

import { Rocket } from 'lucide-react';
import type { DeploymentInfo } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';

/** Deployment platforms and steps (F-37). */
export function DeployCard({ deployment }: { deployment: DeploymentInfo }) {
  const empty = deployment.platforms.length === 0 && deployment.steps.length === 0;
  return (
    <Card id="deploy" title="Deployment" icon={Rocket} count={deployment.platforms.length}>
      {empty ? (
        <EmptyState />
      ) : (
        <>
          {deployment.platforms.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Deployment platforms">
              {deployment.platforms.map((p) => (
                <li key={p} className="rounded-btn border border-border px-2 py-0.5 text-xs">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {deployment.steps.length > 0 && (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {deployment.steps.map((s, i) => (
                <li key={i}>
                  <span className="flex items-start justify-between gap-2">
                    <span>{s.value}</span>
                    <SourceChip source={s.source} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}
