import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Strict allow-list schema for rehype-sanitize (Security spec, Document 5).
 *
 * Rules:
 * - Only the tags below survive. Everything else is unwrapped (its text kept),
 *   and the tags in `strip` are removed together with their content.
 * - No event handlers, no `style`, no `class` except the few classes the
 *   Markdown pipeline itself generates (task lists, code language).
 * - `href` allows http, https, mailto and relative URLs. `src` allows http,
 *   https, relative URLs and data URLs; data URLs are narrowed afterwards to
 *   data:image/(png|jpeg|gif|webp) by `restrictDataUrls` in pipeline.ts.
 * - User-supplied `id` and `name` are prefixed with "user-content-" (DOM clobbering).
 * - `align` is allowed on p, div, img, td, th and on headings (documented relaxation:
 *   centered titles are very common in READMEs and `align` cannot carry script or CSS).
 */

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

const ALIGN: [string, ...string[]] = ['align', 'left', 'right', 'center', 'justify'];

export const STRIPPED_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'noembed',
  'template',
  'title',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'base',
  'meta',
  'link',
  'xmp',
  'plaintext',
];

export const sanitizeSchema: SanitizeSchema = {
  strip: STRIPPED_TAGS,
  clobberPrefix: 'user-content-',
  clobber: ['ariaDescribedBy', 'ariaLabelledBy', 'id', 'name'],
  tagNames: [
    ...HEADINGS,
    'p',
    'br',
    'hr',
    'div',
    'span',
    'a',
    'img',
    'picture',
    'source',
    'details',
    'summary',
    'kbd',
    'sub',
    'sup',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'ul',
    'ol',
    'li',
    'input',
    'blockquote',
    'pre',
    'code',
    'em',
    'strong',
    'b',
    'i',
    'u',
    'del',
    's',
    'strike',
    'ins',
    'mark',
    'small',
    'dl',
    'dt',
    'dd',
    'abbr',
    'samp',
    'var',
    'q',
    'cite',
  ],
  attributes: {
    a: ['href', 'title', 'id', 'name'],
    img: ['src', 'alt', 'title', 'width', 'height', ALIGN],
    source: ['srcSet', 'media', 'type', 'width', 'height'],
    p: [ALIGN],
    div: [ALIGN],
    td: [ALIGN, 'colSpan', 'rowSpan'],
    th: [ALIGN, 'colSpan', 'rowSpan'],
    h1: [ALIGN, 'id'],
    h2: [ALIGN, 'id'],
    h3: [ALIGN, 'id'],
    h4: [ALIGN, 'id'],
    h5: [ALIGN, 'id'],
    h6: [ALIGN, 'id'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    code: [['className', /^language-[\w+#.-]+$/]],
    ul: [['className', 'contains-task-list']],
    ol: ['start', ['className', 'contains-task-list']],
    li: [['className', 'task-list-item']],
    details: ['open'],
    abbr: ['title'],
    q: ['cite'],
  },
  required: {
    input: { type: 'checkbox', disabled: true },
  },
  ancestors: {
    li: ['ol', 'ul'],
    tbody: ['table'],
    tfoot: ['table'],
    thead: ['table'],
    tr: ['table'],
    td: ['table'],
    th: ['table'],
    caption: ['table'],
    input: ['li'],
    source: ['picture'],
    summary: ['details'],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https', 'data'],
    cite: ['http', 'https'],
  },
};
