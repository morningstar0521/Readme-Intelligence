'use client';

import { useState } from 'react';
import { Webhook, Lock, ChevronDown } from 'lucide-react';
import type { ApiEndpoint, HttpMethod } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';
import { EmptyState } from '@/components/common/EmptyState';

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET: 'bg-info-soft',
  POST: 'bg-success-soft',
  PUT: 'bg-warning-soft',
  PATCH: 'bg-warning-soft',
  DELETE: 'bg-error-soft',
  HEAD: 'bg-hover',
  OPTIONS: 'bg-hover',
};

function Endpoint({ ep }: { ep: ApiEndpoint }) {
  const [open, setOpen] = useState(false);
  const hasExamples = Boolean(ep.requestExample || ep.responseExample);
  return (
    <li className="rounded-btn border border-border bg-bg p-2">
      <div className="flex items-center gap-2">
        <span className={`w-14 shrink-0 rounded-[4px] px-1 py-0.5 text-center font-mono text-[11px] font-semibold ${METHOD_STYLE[ep.method]}`}>{ep.method}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={ep.path}>
          {ep.path}
        </code>
        {ep.authRequired && (
          <span title="Authentication mentioned" aria-label="Requires authentication" role="img">
            <Lock className="h-3.5 w-3.5 text-fg-2" aria-hidden />
          </span>
        )}
        <SourceChip source={ep.source} />
      </div>
      {ep.description && <p className="mt-1 text-xs text-fg-2">{ep.description}</p>}
      {hasExamples && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-link hover:underline"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden /> Examples
          </button>
          {open && (
            <div className="mt-1 space-y-1">
              {ep.requestExample && (
                <div>
                  <p className="text-[11px] text-fg-2">Request</p>
                  <pre className="overflow-x-auto rounded-btn bg-surface p-2 font-mono text-[11px]">{ep.requestExample}</pre>
                </div>
              )}
              {ep.responseExample && (
                <div>
                  <p className="text-[11px] text-fg-2">Response</p>
                  <pre className="overflow-x-auto rounded-btn bg-surface p-2 font-mono text-[11px]">{ep.responseExample}</pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** API endpoints (F-36). */
export function ApiCard({ api }: { api: ApiEndpoint[] }) {
  return (
    <Card id="api" title="API endpoints" icon={Webhook} count={api.length}>
      {api.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-1.5">
          {api.map((ep) => (
            <Endpoint key={`${ep.method} ${ep.path}`} ep={ep} />
          ))}
        </ul>
      )}
    </Card>
  );
}
