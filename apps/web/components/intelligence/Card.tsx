'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CardProps {
  id: string;
  title: string;
  icon: LucideIcon;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** Intelligence card shell: icon, title, count, optional action, collapsible body. */
export function Card({
  id,
  title,
  icon: Icon,
  count,
  action,
  children,
  defaultOpen = true,
}: CardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `${id}-body`;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="group rounded-card border border-border bg-surface shadow-[0_1px_0_color-mix(in_srgb,var(--text)_4%,transparent)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_42%,var(--border))]"
      data-testid={`card-${id}`}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-btn text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-btn bg-accent-soft">
            <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
          </span>
          <h2 id={`${id}-title`} className="truncate text-sm font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {typeof count === 'number' && (
            <span
              className="rounded-btn border border-border bg-hover px-1.5 font-mono text-[10px] font-medium leading-5 text-fg-2"
              aria-label={`${count} items`}
            >
              {count}
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-fg-2 transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden
          />
        </button>
        {action}
      </div>
      {open && (
        <div
          id={bodyId}
          className="border-t border-border bg-[color:color-mix(in_srgb,var(--bg)_22%,transparent)] px-3 py-3"
        >
          {children}
        </div>
      )}
    </section>
  );
}
