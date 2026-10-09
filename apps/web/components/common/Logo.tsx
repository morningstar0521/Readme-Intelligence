import Link from 'next/link';

/** Wordmark with a simple document + spark glyph. No emoji in UI chrome (UI spec 7.3). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-btn font-semibold text-fg" aria-label="README Intelligence Viewer home">
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
        <rect x="3.5" y="2.5" width="13" height="19" rx="2.5" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        <path d="M7 8h6M7 12h6M7 16h3.5" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M19.5 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="var(--accent)" />
      </svg>
      {!compact && <span className="hidden text-sm sm:inline">README Intelligence</span>}
    </Link>
  );
}
