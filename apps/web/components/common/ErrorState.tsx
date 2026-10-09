'use client';

import Link from 'next/link';
import { TriangleAlert, RotateCcw, FolderOpen } from 'lucide-react';
import { errorCopy, type AppErrorCode } from '@readme-intel/core';

interface ErrorStateProps {
  code?: AppErrorCode;
  resetAt?: string | null;
  /** Override title/message/causes for non-GitHub errors. */
  title?: string;
  message?: string;
  causes?: string[];
  onRetry?: () => void;
}

/** Friendly error state (F-62): title, one-sentence reason, possible causes, two actions. Never a stack trace. */
export function ErrorState({ code = 'UNKNOWN', resetAt, title, message, causes, onRetry }: ErrorStateProps) {
  const copy = errorCopy(code, resetAt);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-card border border-border bg-surface p-6">
      <div className="flex items-center gap-2 text-error">
        <TriangleAlert className="h-5 w-5" aria-hidden />
        <h1 className="text-lg font-semibold text-fg">{title ?? copy.title}</h1>
      </div>
      <p className="mt-3 text-fg" data-testid="error-message">
        {message ?? copy.message}
      </p>
      {(causes ?? copy.causes).length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium text-fg-2">Possible causes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-fg-2">
            {(causes ?? copy.causes).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Try again
          </button>
        )}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-hover"
        >
          <FolderOpen className="h-4 w-4" aria-hidden /> Open another
        </Link>
      </div>
    </div>
  );
}
