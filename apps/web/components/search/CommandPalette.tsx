'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Fuse from 'fuse.js';
import { Search, Hash, Terminal, KeyRound, Layers, Sparkles, AlignLeft, Code2 } from 'lucide-react';
import type { SearchEntry, SearchEntryKind } from '@readme-intel/core';
import { Modal } from '@/components/common/Modal';

const GROUPS: { kind: SearchEntryKind; label: string; Icon: typeof Hash }[] = [
  { kind: 'section', label: 'Sections', Icon: Hash },
  { kind: 'command', label: 'Commands', Icon: Terminal },
  { kind: 'env', label: 'Env vars', Icon: KeyRound },
  { kind: 'tech', label: 'Tech', Icon: Layers },
  { kind: 'feature', label: 'Features', Icon: Sparkles },
  { kind: 'paragraph', label: 'Text', Icon: AlignLeft },
  { kind: 'code', label: 'Code', Icon: Code2 },
];

const MAX_PER_GROUP = 6;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  entries: SearchEntry[];
  onSelect: (entry: SearchEntry) => void;
}

/**
 * Cmd/Ctrl+K search (F-23, F-24) across headings, text, code, commands, env vars, tech and features.
 * Arrow keys move, Enter selects, Escape closes.
 */
export function CommandPalette({ open, onClose, entries, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(entries, {
        keys: [
          { name: 'title', weight: 2 },
          { name: 'text', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [entries]
  );

  const flat = useMemo(() => {
    const q = query.trim();
    const results = q ? fuse.search(q, { limit: 80 }).map((r) => r.item) : entries.filter((e) => e.kind === 'section');
    const out: { group: (typeof GROUPS)[number]; entry: SearchEntry }[] = [];
    for (const group of GROUPS) {
      const items = results.filter((e) => e.kind === group.kind).slice(0, q ? MAX_PER_GROUP : 50);
      for (const entry of items) out.push({ group, entry });
    }
    return out;
  }, [query, fuse, entries]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (i: number) => {
    const item = flat[i];
    if (!item) return;
    onClose();
    // Let the modal unmount (and restore scroll) before jumping.
    window.setTimeout(() => onSelect(item.entry), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (flat.length === 0 ? 0 : (a + 1) % flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (flat.length === 0 ? 0 : (a - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  let lastGroup: string | null = null;
  return (
    <Modal open={open} onClose={onClose} title="Search README" bare className="max-w-xl">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 text-fg-2" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search sections, commands, env vars, tech..."
          aria-label="Search README"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={flat[active] ? `palette-item-${active}` : undefined}
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-2"
          data-testid="palette-input"
        />
        <kbd className="rounded-[4px] border border-border px-1.5 font-mono text-[11px] text-fg-2">Esc</kbd>
      </div>
      <ul id="palette-results" role="listbox" ref={listRef} className="thin-scroll max-h-[60vh] overflow-y-auto py-2" aria-label="Search results">
        {flat.length === 0 && <li className="px-4 py-6 text-center text-sm text-fg-2">No results for &quot;{query}&quot;</li>}
        {flat.map(({ group, entry }, i) => {
          const header = group.kind !== lastGroup ? group.label : null;
          lastGroup = group.kind;
          const Icon = group.Icon;
          return (
            <li key={entry.id} role="none">
              {header && <p className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-2">{header}</p>}
              <div
                id={`palette-item-${i}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                data-kind={entry.kind}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(i)}
                className={`mx-2 flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-sm ${i === active ? 'bg-accent-soft' : ''}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-fg-2" aria-hidden />
                <span className={`min-w-0 flex-1 truncate ${entry.kind === 'command' || entry.kind === 'env' || entry.kind === 'code' ? 'font-mono text-xs' : ''}`}>{entry.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-2">L{entry.line}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
