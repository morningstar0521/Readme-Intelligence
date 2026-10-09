/** Small, dependency-free text helpers shared by the extractors. */

/** Matches pictographic emoji, variation selectors, ZWJ and keycap marks. */
// eslint-disable-next-line no-misleading-character-class
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Remove emoji characters. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '');
}

/** Collapse all whitespace to single spaces and trim. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Clean a list item / heading value for display:
 * strips leading emoji, bullets, numbering, bold markers and trailing colons.
 */
export function cleanItemText(text: string): string {
  let out = stripEmoji(text);
  out = out.replace(/\*\*|__/g, '');
  out = collapseWhitespace(out);
  out = out.replace(/^(?:[-*+•▪►✓✔→]\s*)+/, '');
  out = out.replace(/^(?::[a-z0-9_+-]+:\s*)+/i, '');
  out = out.replace(/^\d+[.)]\s+/, '');
  return out.trim();
}

/** Truncate on a word boundary and add an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** Escape a string for use inside a RegExp. */
export function escapeRegExp(text: string): string {
  // "-" is intentionally not escaped: "\-" is invalid outside classes in unicode mode.
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Build a whole-word, case-insensitive (by default) matcher for a term.
 * Word characters are letters and digits, so "react" will not match "reactive"
 * and "node.js" still matches as a whole token.
 */
export function wholeWordRegExp(term: string, flags = 'i'): RegExp {
  // ASCII + Latin-1/Latin Extended letters as word characters. Avoids \p{..} classes,
  // which are slow to compile when hundreds of dictionary patterns are built at startup.
  const W = 'A-Za-z0-9\\u00C0-\\u024F';
  return new RegExp(`(?<![${W}])${escapeRegExp(term)}(?![${W}])`, flags);
}

/** Strip HTML tags from a string and decode the few entities that matter for text. */
export function stripHtml(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

/** Byte length of a string in UTF-8. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
