'use client';

import { Modal } from './Modal';
import { useIsMac } from '@/lib/hooks';

/** Keyboard shortcuts modal (F-63). Opened with "?". */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = useIsMac();
  const mod = mac ? '⌘' : 'Ctrl';
  const rows: [string, string[]][] = [
    ['Search', [mod, 'K']],
    ['Toggle contents panel', [mod, 'B']],
    ['Toggle intelligence panel', [mod, 'Shift', 'B']],
    ['Move in search results', ['↑', '↓']],
    ['Open search result', ['Enter']],
    ['Close dialog', ['Esc']],
    ['Show shortcuts', ['?']],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="divide-y divide-border px-4 py-2 text-sm">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between py-2">
            <dt className="text-fg-2">{label}</dt>
            <dd className="flex gap-1">
              {keys.map((k) => (
                <kbd key={k} className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
