import { unified } from 'unified';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { toHtml } from 'hast-util-to-html';
import { toString as hastToString } from 'hast-util-to-string';
import type { Element, ElementContent, Root as HastRoot, RootContent as HastRootContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type { HeadingInfo, SourceInfo } from '../types';
import { sanitizeSchema } from './sanitizeSchema';
import { getScheme, resolveSrcSet, resolveUrl } from './resolveUrls';
import { transformAlert } from './alerts';
import { createSlugger } from '../parse/slug';
import { parseMarkdown } from '../parse/parseMarkdown';

/**
 * Render pipeline:
 *   mdast -> hast (remark-rehype, raw HTML kept as raw nodes)
 *         -> rehype-raw (parse embedded HTML)
 *         -> rehype-sanitize (strict allow-list, ALWAYS before anything else touches HTML)
 *         -> post-processing on the sanitized tree:
 *            URL resolution, external link rel/target, task-list input check,
 *            GitHub alerts, GitHub heading slugs, data-line attributes.
 *
 * Post-processing only ever adds trusted values (our own classes, resolved URLs, ids).
 */

export interface RenderResult {
  hast: HastRoot;
  headings: HeadingInfo[];
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements that get a data-line attribute so "jump to source" can find them. */
const LINE_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'pre',
  'blockquote',
  'table',
  'tr',
  'div',
  'details',
  'hr',
  'ul',
  'ol',
  'img',
  'picture',
  'dl',
  'dt',
  'dd',
]);

const toHast = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema);

function hasClass(el: Element, name: string): boolean {
  const cls = el.properties?.className;
  return Array.isArray(cls) ? cls.includes(name) : cls === name;
}

function isExternalHttp(url: string): boolean {
  const scheme = getScheme(url);
  return scheme === 'http' || scheme === 'https';
}

/** Rewrite href/src/srcset on one element. Returns false if the element must be removed. */
function processUrls(el: Element, source: SourceInfo): boolean {
  const props = el.properties ?? (el.properties = {});

  if (el.tagName === 'a' && typeof props.href === 'string') {
    const original = props.href;
    const resolved = resolveUrl(original, 'link', source);
    if (resolved === null) {
      delete props.href;
      if (getScheme(original) === null && !original.startsWith('#')) props.title = original;
    } else {
      props.href = resolved;
      if (isExternalHttp(resolved)) {
        props.target = '_blank';
        props.rel = ['noopener', 'noreferrer', 'nofollow'];
      }
    }
  }

  if (el.tagName === 'img') {
    const original = typeof props.src === 'string' ? props.src : '';
    const resolved = original ? resolveUrl(original, 'image', source) : null;
    if (resolved === null) {
      delete props.src;
      const relative = original !== '' && getScheme(original) === null && !original.startsWith('#');
      props.dataUnavailable = relative ? original : 'blocked';
    } else {
      props.src = resolved;
    }
    props.loading = 'lazy';
    props.decoding = 'async';
  }

  if (el.tagName === 'source') {
    const srcset = props.srcSet;
    const value = Array.isArray(srcset) ? srcset.join(', ') : typeof srcset === 'string' ? srcset : '';
    const resolved = value ? resolveSrcSet(value, source) : null;
    if (resolved === null) return false;
    props.srcSet = resolved;
  }

  return true;
}

interface WalkFrame {
  node: HastRoot | Element;
  line: number;
}

/**
 * Iterative post-processing walk over the sanitized tree.
 * Iterative (not recursive) so deeply nested input cannot overflow the stack.
 */
function postProcess(tree: HastRoot, source: SourceInfo): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const slugger = createSlugger();
  const stack: WalkFrame[] = [{ node: tree, line: 1 }];

  // Headings must be slugged in document order, so collect them in pre-order first.
  const orderedHeadings: { el: Element; line: number }[] = [];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const parent = frame.node;
    const kept: (ElementContent | HastRootContent)[] = [];

    for (const child of parent.children as (ElementContent | HastRootContent)[]) {
      if (child.type !== 'element') {
        kept.push(child);
        continue;
      }
      const el = child;
      const ownLine = el.position?.start.line ?? frame.line;

      // Only task-list checkboxes may remain.
      if (el.tagName === 'input') {
        const isTask = parent.type === 'element' && parent.tagName === 'li' && hasClass(parent, 'task-list-item');
        if (!isTask) continue;
      }

      if (!processUrls(el, source)) continue;

      // Images inside links follow the link on click instead of opening the zoom view.
      if (el.tagName === 'img' && parent.type === 'element' && parent.tagName === 'a') {
        el.properties = { ...el.properties, dataInLink: 'true' };
      }

      transformAlert(el);

      if (LINE_TAGS.has(el.tagName)) {
        el.properties = { ...el.properties, dataLine: ownLine };
      }

      if (HEADING_TAGS.has(el.tagName)) orderedHeadings.push({ el, line: ownLine });

      kept.push(el);
    }

    parent.children = kept as typeof parent.children;

    // Push children in reverse so they are processed in document order (pre-order).
    for (let i = kept.length - 1; i >= 0; i--) {
      const c = kept[i]!;
      if (c.type === 'element') stack.push({ node: c, line: c.position?.start.line ?? frame.line });
    }
  }

  // The stack walk above visits siblings in order but descends depth-first only after
  // finishing a parent's direct children; sort by source position to get document order.
  orderedHeadings.sort((a, b) => {
    const pa = a.el.position?.start.offset ?? Number.MAX_SAFE_INTEGER;
    const pb = b.el.position?.start.offset ?? Number.MAX_SAFE_INTEGER;
    return a.line - b.line || pa - pb;
  });

  for (const { el, line } of orderedHeadings) {
    const text = hastToString(el).replace(/\s+/g, ' ').trim();
    const id = text ? slugger.slug(text) : '';
    if (id) el.properties = { ...el.properties, id };
    else if (el.properties) delete el.properties.id;
    headings.push({
      id,
      text,
      depth: Number(el.tagName.slice(1)) as HeadingInfo['depth'],
      line,
    });
  }

  return headings;
}

/** Render an mdast (from parseMarkdown) into a sanitized, post-processed hast. */
export function renderMdast(mdast: MdastRoot, source: SourceInfo): RenderResult {
  try {
    const clone = structuredClone(mdast);
    const hast = toHast.runSync(clone) as HastRoot;
    const headings = postProcess(hast, source);
    return { hast, headings };
  } catch {
    return {
      hast: {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            properties: {},
            children: [{ type: 'text', value: 'The file could not be read as Markdown.' }],
          },
        ],
      },
      headings: [],
    };
  }
}

/** Serialize a rendered hast to an HTML string. */
export function hastToHtml(hast: HastRoot): string {
  return toHtml(hast);
}

/** Convenience: Markdown string to sanitized HTML string (used by tests and exports). */
export function renderToHtml(markdown: string, source: SourceInfo = { kind: 'paste' }): string {
  const { mdast } = parseMarkdown(markdown);
  return hastToHtml(renderMdast(mdast, source).hast);
}
