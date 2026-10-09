import type { HeadingInfo, TocItem } from '../types';

/**
 * Build the table of contents (h1 to h4) from the headings of the rendered document.
 * Skipped levels are kept as-is (an h3 directly under an h1 stays depth 3).
 * Headings without text are dropped.
 */
export function buildToc(headings: HeadingInfo[]): TocItem[] {
  const toc: TocItem[] = [];
  for (const h of headings) {
    if (h.depth > 4) continue;
    const text = h.text.replace(/\s+/g, ' ').trim();
    if (!text || !h.id) continue;
    toc.push({ id: h.id, text, depth: h.depth as TocItem['depth'], line: h.line });
  }
  return toc;
}
