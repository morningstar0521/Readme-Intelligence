'use client';

import { KeyRound, Lock } from 'lucide-react';
import type { EnvVarItem } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { CopyButton } from '@/components/common/CopyButton';
import { EmptyState } from '@/components/common/EmptyState';

function RequiredBadge({ required }: { required: boolean | null }) {
  if (required === true) return <span className="rounded-[4px] bg-error-soft px-1.5 py-0.5 text-[11px] font-medium text-fg">required</span>;
  if (required === false) return <span className="rounded-[4px] bg-hover px-1.5 py-0.5 text-[11px] font-medium text-fg-2">optional</span>;
  return <span className="text-[11px] text-fg-2" title="The README does not say">not stated</span>;
}

/** Environment variables (F-34): name, required/optional, description, masked example value. */
export function EnvCard({ envVars }: { envVars: EnvVarItem[] }) {
  return (
    <Card id="env" title="Environment variables" icon={KeyRound} count={envVars.length}>
      {envVars.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="-mx-3 overflow-x-auto px-3">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-fg-2">
                <th scope="col" className="pb-1 pr-2 font-medium">
                  Name
                </th>
                <th scope="col" className="pb-1 pr-2 font-medium">
                  Required
                </th>
                <th scope="col" className="pb-1 pr-2 font-medium">
                  Description
                </th>
                <th scope="col" className="pb-1 font-medium">
                  Example
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {envVars.map((v) => (
                <tr key={v.name} className="align-top">
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-0.5">
                      <code className="break-all font-mono text-xs">{v.name}</code>
                      <CopyButton text={v.name} label={`Copy ${v.name}`} className="!px-1" />
                    </div>
                    <SourceChip source={v.source} className="-ml-1" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <RequiredBadge required={v.required} />
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-fg-2">{v.description ?? '-'}</td>
                  <td className="py-1.5 font-mono text-xs">
                    {v.exampleValue === null ? (
                      <span className="text-fg-2">-</span>
                    ) : v.masked ? (
                      <span className="inline-flex items-center gap-1" title="Looks like a secret, value hidden">
                        <Lock className="h-3 w-3 text-fg-2" aria-hidden />
                        <span aria-label="Hidden secret value">{v.exampleValue}</span>
                      </span>
                    ) : (
                      <span className="break-all">{v.exampleValue}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
