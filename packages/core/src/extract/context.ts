import type { Root, RootContent, Heading, Html } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { HeadingInfo, SectionInfo, SectionType, SourceRef } from '../types';
import { classifySection } from './section-classifier';
import { collapseWhitespace, stripHtml } from '../util/text';

/**
 * Document context shared by every extractor.
 *
 * The mdast root is flat: headings are siblings of the content below them.
 * We walk the root children once, keep a heading stack, and give every top-level
 * block its heading path, its effective section type (own type or inherited) and
 * the anchor of the nearest heading. Headings written as raw HTML (<h2>..</h2>)
 * are recognised too.
 */

export interface Block {
  node: RootContent;
  /** Heading texts from the outermost to the nearest heading. */
  headingPath: string[];
  /** Effective section type of the nearest heading (own or inherited). */
  section: SectionType | null;
  /** All effective types on the heading stack (nearest last). */
  sectionStack: (SectionType | null)[];
  /** Slug of the nearest heading. */
  anchor?: string;
  /** True when this block is itself a heading. */
  isHeading: boolean;
  /** Depth of this heading (1-6) if isHeading. */
  headingDepth?: number;
  /** Text of the heading if isHeading. */
  headingText?: string;
  line: number;
}

export interface DocContext {
  root: Root;
  blocks: Block[];
  sections: SectionInfo[];
  /** Text of the document title (first h1 at the top), if any. */
  titleText: string | null;
  titleLine: number | null;
  /** Map from heading line to slug, from the rendered document. */
  anchorsByLine: Map<number, string>;
}

interface StackEntry {
  text: string;
  depth: number;
  type: SectionType | null;
  anchor?: string;
}

const HTML_HEADING_RE = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*$/i;

/** If the node is a heading (Markdown or a raw HTML heading block), return its depth and text. */
export function headingOf(node: RootContent): { depth: number; text: string } | null {
  if (node.type === 'heading') {
    return { depth: (node as Heading).depth, text: collapseWhitespace(mdastToString(node)) };
  }
  if (node.type === 'html') {
    const m = HTML_HEADING_RE.exec((node as Html).value);
    if (m) return { depth: Number(m[1]), text: stripHtml(m[2] ?? '') };
  }
  return null;
}

const BLOCK_CONTAINERS = new Set(['root', 'list', 'listItem', 'table', 'tableRow', 'blockquote', 'footnoteDefinition']);

/**
 * Plain text of a node. Unlike mdast-util-to-string, block containers (lists, list items,
 * tables, rows, blockquotes) join their children with spaces and table cells with " | ",
 * so "Database" + "PostgreSQL" never becomes "DatabasePostgreSQL".
 */
export function blockText(node: unknown): string {
  const n = node as { type?: string; children?: unknown[] };
  if (!n || typeof n !== 'object') return '';
  if (n.type && BLOCK_CONTAINERS.has(n.type) && Array.isArray(n.children)) {
    const sep = n.type === 'tableRow' ? ' | ' : ' ';
    return collapseWhitespace(n.children.map((c) => blockText(c)).join(sep));
  }
  return collapseWhitespace(mdastToString(node as Parameters<typeof mdastToString>[0]));
}

export function lineOf(node: { position?: { start: { line: number } } } | undefined | null): number {
  return node?.position?.start.line ?? 0;
}

export function buildContext(root: Root, headings: HeadingInfo[] = []): DocContext {
  const anchorsByLine = new Map<number, string>();
  for (const h of headings) {
    if (h.id && !anchorsByLine.has(h.line)) anchorsByLine.set(h.line, h.id);
  }

  const blocks: Block[] = [];
  const sections: SectionInfo[] = [];
  const stack: StackEntry[] = [];
  let titleText: string | null = null;
  let titleLine: number | null = null;
  let seenContentHeading = false;

  for (const node of root.children) {
    const line = lineOf(node);
    const heading = headingOf(node);

    if (heading) {
      const anchor = anchorsByLine.get(line);
      // The first h1 before any other heading is the document title: never classified.
      const isTitle = heading.depth === 1 && titleText === null && !seenContentHeading;
      if (isTitle) {
        titleText = heading.text;
        titleLine = line;
        stack.length = 0;
        stack.push({ text: heading.text, depth: 1, type: null, anchor });
        blocks.push({
          node,
          headingPath: [heading.text],
          section: null,
          sectionStack: [null],
          anchor,
          isHeading: true,
          headingDepth: 1,
          headingText: heading.text,
          line,
        });
        continue;
      }
      seenContentHeading = true;

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= heading.depth) stack.pop();
      // The title h1 should not swallow h1 sections that come after it.
      const parentType = stack.length > 0 ? stack[stack.length - 1]!.type : null;
      const ownType = classifySection(heading.text);
      const type = ownType ?? parentType;
      stack.push({ text: heading.text, depth: heading.depth, type, anchor });

      sections.push({ text: heading.text, depth: heading.depth, line, anchor, ownType, type });
      blocks.push({
        node,
        headingPath: stack.map((s) => s.text),
        section: type,
        sectionStack: stack.map((s) => s.type),
        anchor,
        isHeading: true,
        headingDepth: heading.depth,
        headingText: heading.text,
        line,
      });
      continue;
    }

    const top = stack[stack.length - 1];
    blocks.push({
      node,
      headingPath: stack.map((s) => s.text),
      section: top?.type ?? null,
      sectionStack: stack.map((s) => s.type),
      anchor: top?.anchor,
      isHeading: false,
      line,
    });
  }

  return { root, blocks, sections, titleText, titleLine, anchorsByLine };
}

/** SourceRef for a node inside a block. */
export function refFor(block: Block, node?: { position?: { start: { line: number } } }): SourceRef {
  const line = lineOf(node) || block.line;
  const ref: SourceRef = { headingPath: [...block.headingPath], line };
  if (block.anchor) ref.anchor = block.anchor;
  return ref;
}

/** Blocks whose effective section is one of `types`. Heading blocks are included. */
export function blocksIn(ctx: DocContext, ...types: SectionType[]): Block[] {
  return ctx.blocks.filter((b) => b.section !== null && types.includes(b.section));
}

/** True if any heading's own text classifies as the given section type. */
export function hasSection(ctx: DocContext, type: SectionType): boolean {
  return ctx.sections.some((s) => s.ownType === type);
}
