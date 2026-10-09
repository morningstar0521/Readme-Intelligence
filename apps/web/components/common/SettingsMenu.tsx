'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useSettings } from '@/lib/settings';
import { ThemeToggle } from './ThemeToggle';

/** Settings popover: theme and remote image blocking, with the remote images notice. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { blockRemoteImages, setBlockRemoteImages } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-btn p-2 text-fg-2 transition-colors hover:bg-hover hover:text-fg"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-card border border-border bg-elevated p-4 shadow-xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-2">Theme</p>
          <ThemeToggle />
          <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-fg-2">Images</p>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={blockRemoteImages}
              onChange={(e) => setBlockRemoteImages(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Block remote images
          </label>
          <p className="mt-2 text-xs leading-relaxed text-fg-2">
            Images are loaded from their original URLs, so image hosts can see your IP address. Block them for full privacy.
          </p>
        </div>
      )}
    </div>
  );
}
