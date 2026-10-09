'use client';

import { useEffect, useMemo, useState } from 'react';
import { ListOrdered, WrapText, ChevronDown, ChevronUp } from 'lucide-react';
import { CopyButton } from '@/components/common/CopyButton';
import { highlight } from './highlighter';

interface CodeBlockProps {
  code: string;
  lang: string | null;
  line?: number;
}

const COLLAPSE_AFTER = 30;

/**
 * Fenced code block (UI spec 7.4): language badge, copy, line numbers and word-wrap toggles,
 * collapse after 30 lines. Shows plain escaped text first, then swaps in Shiki output.
 * Shiki HTML is generated from the code string by Shiki itself (it escapes the content),
 * so it is safe to inject; README HTML is never injected.
 */
export function CodeBlock({ code, lang, line }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [numbered, setNumbered] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const text = code.replace(/\n$/, '');
  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const collapsible = lineCount > COLLAPSE_AFTER;

  useEffect(() => {
    let cancelled = false;
    highlight(text, lang).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [text, lang]);

  const plainLines = useMemo(() => text.split('\n'), [text]);
  const classes = ['code-block', 'relative overflow-hidden rounded-card border border-border bg-surface', numbered ? 'numbered' : '', wrap ? 'wrap' : '', html ? '' : 'plain'];

  return (
    <div className={classes.join(' ')} data-line={line}>
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="rounded-[4px] bg-hover px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-fg-2">{lang || 'text'}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setNumbered((v) => !v)}
            aria-pressed={numbered}
            aria-label="Toggle line numbers"
            title="Line numbers"
            className={`rounded-btn p-1 transition-colors hover:bg-hover ${numbered ? 'text-fg' : 'text-fg-2'}`}
          >
            <ListOrdered className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            aria-pressed={wrap}
            aria-label="Toggle word wrap"
            title="Word wrap"
            className={`rounded-btn p-1 transition-colors hover:bg-hover ${wrap ? 'text-fg' : 'text-fg-2'}`}
          >
            <WrapText className="h-3.5 w-3.5" aria-hidden />
          </button>
          <CopyButton text={text} label="Copy code" />
        </div>
      </div>
      <div className={collapsible && !expanded ? 'max-h-[calc(30*1.6*13px+24px)] overflow-hidden' : ''}>
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>
            <code>
              {plainLines.map((l, i) => (
                <span className="line" key={i}>
                  {l}
                  {i < plainLines.length - 1 ? '\n' : ''}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1 border-t border-border py-1.5 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden /> Show more ({lineCount - COLLAPSE_AFTER} more lines)
            </>
          )}
        </button>
      )}
    </div>
  );
}
