'use client';

import { ErrorState } from '@/components/common/ErrorState';

/** Route-level error boundary: friendly message, never a stack trace (F-62). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState code="UNKNOWN" onRetry={reset} />;
}
