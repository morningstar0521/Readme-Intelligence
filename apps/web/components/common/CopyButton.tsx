'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/hooks';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  /** Show the text label next to the icon. */
  showLabel?: boolean;
}

/** Copy to clipboard and show "Copied" for 1.5 s. */
export function CopyButton({ text, label = 'Copy', className = '', showLabel = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={`inline-flex items-center gap-1 rounded-btn px-1.5 py-1 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {showLabel && <span>{copied ? 'Copied' : label}</span>}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}
