'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, TriangleAlert, Check } from 'lucide-react';
import type { CommandCategory, CommandItem } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';
import { copyText } from '@/lib/hooks';

const ORDER: CommandCategory[] = ['setup', 'dev', 'build', 'test', 'lint', 'docker', 'database', 'deploy', 'other'];
const LABELS: Record<CommandCategory, string> = {
  setup: 'Setup',
  dev: 'Run / dev',
  build: 'Build',
  test: 'Test',
  lint: 'Lint / format',
  docker: 'Docker',
  database: 'Database',
  deploy: 'Deploy',
  other: 'Other',
};

/** Commands grouped by purpose (F-33). Click a row to copy; risky commands get a warning icon. Never executed. */
export function CommandsCard({ commands }: { commands: CommandItem[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (cmd: string) => {
    if (!(await copyText(cmd))) return;
    setCopied(cmd);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card id="commands" title="Commands" icon={Terminal} count={commands.length}>
      {commands.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {ORDER.map((cat) => {
            const items = commands.filter((c) => c.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-2">{LABELS[cat]}</p>
                <ul className="space-y-1">
                  {items.map((c) => (
                    <li key={c.command} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => copy(c.command)}
                        title="Click to copy"
                        aria-label={`Copy command: ${c.command}`}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-btn border border-border bg-bg px-2 py-1 text-left transition-colors hover:border-[color:var(--link)]"
                      >
                        <code className="min-w-0 flex-1 truncate font-mono text-xs">{c.command}</code>
                        {copied === c.command ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-success" role="status">
                            <Check className="h-3 w-3" aria-hidden /> Copied
                          </span>
                        ) : null}
                      </button>
                      {c.risky && (
                        <span
                          className="shrink-0 text-warning"
                          title="Review before running: this command uses sudo, deletes files, pipes a download into a shell or opens permissions."
                          aria-label="Risky command: review before running"
                          role="img"
                        >
                          <TriangleAlert className="h-4 w-4" aria-hidden />
                        </span>
                      )}
                      <SourceChip source={c.source} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="text-[11px] text-fg-2">Commands are copied, never run. Read them before using.</p>
        </div>
      )}
    </Card>
  );
}
