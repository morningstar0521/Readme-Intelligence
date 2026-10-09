'use client';

import { Layers } from 'lucide-react';
import type { TechCategory, TechItem } from '@readme-intel/core';
import { Card } from './Card';
import { EmptyState } from '@/components/common/EmptyState';
import { useJump } from '@/lib/jump';

const LABELS: Record<TechCategory, string> = {
  language: 'Languages',
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  auth: 'Auth',
  'ai-ml': 'AI / ML',
  cloud: 'Cloud',
  devops: 'DevOps',
  testing: 'Testing',
  tooling: 'Tooling',
};
const ORDER = Object.keys(LABELS) as TechCategory[];

/** Tech stack grouped by category with evidence on hover / focus (F-35). Click jumps to the first evidence. */
export function TechStackCard({ tech }: { tech: TechItem[] }) {
  const { jumpToLine } = useJump();
  return (
    <Card id="tech" title="Tech stack" icon={Layers} count={tech.length}>
      {tech.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {ORDER.map((cat) => {
            const items = tech.filter((t) => t.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-2">{LABELS[cat]}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {items.map((t) => {
                    const first = t.evidence[0]!;
                    const tipId = `tech-tip-${t.name.replace(/[^a-z0-9]/gi, '-')}`;
                    return (
                      <li key={t.name} className="group relative">
                        <button
                          type="button"
                          onClick={() => jumpToLine(first.source.line)}
                          aria-describedby={tipId}
                          className={`rounded-btn border px-2 py-0.5 text-xs transition-colors hover:bg-hover ${t.strength === 'strong' ? 'border-border' : 'border-dashed border-border text-fg-2'}`}
                        >
                          {t.name}
                        </button>
                        <div
                          id={tipId}
                          role="tooltip"
                          className="pointer-events-none invisible absolute bottom-full left-0 z-30 mb-1 w-64 rounded-btn border border-border bg-elevated p-2 text-xs opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                        >
                          <p className="mb-1 font-medium">
                            {t.name} <span className="font-normal text-fg-2">({t.strength} evidence)</span>
                          </p>
                          <ul className="space-y-1">
                            {t.evidence.map((e, i) => (
                              <li key={i} className="text-fg-2">
                                <span className="font-medium text-fg">{e.type}</span> · line {e.source.line}: <span className="break-words font-mono">{e.snippet}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="text-[11px] text-fg-2">Dashed chips are passing mentions (weak evidence). Hover a chip to see where it was found.</p>
        </div>
      )}
    </Card>
  );
}
