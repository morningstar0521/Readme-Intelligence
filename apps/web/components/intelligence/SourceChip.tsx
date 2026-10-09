'use client';

import { CornerDownRight } from 'lucide-react';
import type { SourceRef } from '@readme-intel/core';
import { useJump } from '@/lib/jump';

/** "Jump to source" action shown on every extracted item (F-39). */
export function SourceChip({ source, className = '' }: { source: SourceRef; className?: string }) {
  const { jumpToLine } = useJump();
  const where = source.headingPath.length > 0 ? ` in "${source.headingPath[source.headingPath.length - 1]}"` : '';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        jumpToLine(source.line);
      }}
      title={`Jump to line ${source.line}${where}`}
      aria-label={`Jump to source, line ${source.line}${where}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-btn px-1 py-0.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-hover hover:text-fg ${className}`}
    >
      <CornerDownRight className="h-3 w-3" aria-hidden />L{source.line}
    </button>
  );
}
