'use client';

import { Sparkles } from 'lucide-react';
import type { Evidenced } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';

/** Features from the Features section only (F-31). Never inferred from other text. */
export function FeaturesCard({ features }: { features: Evidenced<string>[] }) {
  return (
    <Card id="features" title="Features" icon={Sparkles} count={features.length}>
      {features.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-1.5">
          {features.map((f, i) => (
            <li key={`${f.value}-${i}`} className="flex items-start justify-between gap-2 text-sm">
              <span className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--text-secondary)]" aria-hidden />
                {f.value}
              </span>
              <SourceChip source={f.source} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
