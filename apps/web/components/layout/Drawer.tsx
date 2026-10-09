'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  side: 'left' | 'right';
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Slide-over panel used below 1024 px (UI spec 7.1). */
export function Drawer({ open, side, title, onClose, children }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    window.setTimeout(() => panel.current?.focus(), 0);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`thin-scroll absolute top-0 h-full w-[min(90vw,400px)] overflow-y-auto border-border bg-bg p-3 shadow-2xl ${side === 'left' ? 'left-0 border-r' : 'right-0 border-l'}`}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{title}</p>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="rounded-btn p-1.5 text-fg-2 hover:bg-hover hover:text-fg">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
