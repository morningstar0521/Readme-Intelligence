import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkGemoji from 'remark-gemoji';
import type { Root, RootContent, Parent, Paragraph } from 'mdast';
import { utf8ByteLength } from '../util/text';

/** Max accepted input. Larger input is truncated with a warning (Security spec: resource exhaustion). */
export const MAX_INPUT_BYTES = 1024 * 1024;
/** Max list nesting depth kept in the tree. Deeper lists are replaced with a notice. */
export const MAX_LIST_DEPTH = 20;
/** Max blockquote markers kept at the start of a line. */
const MAX_QUOTE_MARKERS = 20;
/** Max leading indentation kept on a line. */
const MAX_INDENT = 120;

export interface ParseResult {
  mdast: Root;
  /** The markdown actually parsed (after truncation and normalisation). */
  markdown: string;
  warnings: string[];
  truncated: boolean;
}

/** Cut a string so that its UTF-8 size is at most maxBytes, without splitting a character. */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  const bytes = new TextEncoder().encode(text).slice(0, maxBytes);
  // fatal: false drops a split trailing character as U+FFFD; strip it.
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/�+$/, '');
}

/**
 * Normalise input before parsing. Keeps the line count identical so that
 * line numbers in the mdast match the original README.
 */
export function preprocessMarkdown(input: string): {
  markdown: string;
  warnings: string[];
  truncated: boolean;
} {
  const warnings: string[] = [];
  let markdown = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let truncated = false;

  if (utf8ByteLength(markdown) > MAX_INPUT_BYTES) {
    markdown = truncateToBytes(markdown, MAX_INPUT_BYTES);
    truncated = true;
    warnings.push('Input is larger than 1 MB. Only the first 1 MB was parsed.');
  }

  let cappedLines = 0;
  markdown = markdown
    .split('\n')
    .map((line) => {
      let out = line;
      const quote = /^(\s*(?:>\s*){21,})/.exec(out);
      if (quote) {
        out = '>'.repeat(MAX_QUOTE_MARKERS) + ' ' + out.slice(quote[1]!.length);
        cappedLines++;
      }
      const indent = /^[ \t]+/.exec(out);
      if (indent && indent[0].length > MAX_INDENT) {
        out = out.slice(indent[0].length - MAX_INDENT);
        cappedLines++;
      }
      return out;
    })
    .join('\n');

  if (cappedLines > 0) {
    warnings.push(`Nesting was limited on ${cappedLines} line(s) to keep rendering safe.`);
  }

  return { markdown, warnings, truncated };
}

/**
 * Replace lists nested deeper than MAX_LIST_DEPTH with a short notice paragraph.
 * Iterative so that a hostile document cannot overflow the call stack.
 */
export function limitListNesting(tree: Root, maxDepth = MAX_LIST_DEPTH): number {
  let pruned = 0;
  const stack: { node: Parent; listDepth: number }[] = [{ node: tree, listDepth: 0 }];
  while (stack.length > 0) {
    const { node, listDepth } = stack.pop()!;
    const children = node.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const depth = child.type === 'list' ? listDepth + 1 : listDepth;
      if (child.type === 'list' && depth > maxDepth) {
        const notice: Paragraph = {
          type: 'paragraph',
          children: [{ type: 'text', value: '[Nested list truncated: too deep]' }],
          position: child.position,
        };
        children[i] = notice;
        pruned++;
        continue;
      }
      if ('children' in child && Array.isArray(child.children)) {
        stack.push({ node: child as Parent, listDepth: depth });
      }
    }
  }
  return pruned;
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkGemoji);

/**
 * Parse Markdown into an mdast with positions. Never throws: on an internal
 * error it returns an empty tree and a warning.
 */
export function parseMarkdown(input: string): ParseResult {
  const pre = preprocessMarkdown(typeof input === 'string' ? input : '');
  const warnings = [...pre.warnings];
  let mdast: Root;
  try {
    mdast = processor.runSync(processor.parse(pre.markdown)) as Root;
  } catch {
    warnings.push('The file could not be read as Markdown.');
    mdast = { type: 'root', children: [] };
  }
  const pruned = limitListNesting(mdast);
  if (pruned > 0) warnings.push(`${pruned} list(s) nested deeper than ${MAX_LIST_DEPTH} levels were truncated.`);
  return { mdast, markdown: pre.markdown, warnings, truncated: pre.truncated };
}
