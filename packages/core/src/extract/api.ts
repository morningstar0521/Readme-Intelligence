import type { Code, List, Table, TableRow, RootContent } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { ApiEndpoint, HttpMethod } from '../types';
import type { Block, DocContext } from './context';
import { blockText, refFor, lineOf } from './context';
import { collapseWhitespace, truncate } from '../util/text';

/**
 * API endpoints extractor (Extractor spec 4.8, P1).
 * - Text, headings, list items and tables are only read inside API sections.
 * - Code blocks are read anywhere, but only lines that start with an HTTP verb + path,
 *   or `curl -X METHOD <url>`.
 * - JSON code blocks that follow an endpoint (inside an API section) are attached as
 *   request / response examples when their label mentions "request" or "response".
 * - authRequired is true only when nearby text mentions auth, token, bearer or an API key.
 */

const METHOD_LINE_RE = /^\s*(?:(?:[-*]|#|\/\/|--)\s*)?`?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s`'"<>]*)`?(.*)$/;
const CURL_RE = /\bcurl\b.*?(?:-X|--request)\s*['"]?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"]?\b.*?['"]?((?:https?:\/\/[^\s'"]+)|(?:\/[^\s'"]+))/i;
const CURL_URL_RE = /\bcurl\b.*?((?:https?:\/\/[^\s'"]+)|(?:\/[^\s'"]+))/i;
const AUTH_RE = /\b(auth|authenticated|authentication|authorization|authorized|token|bearer|api[\s_-]?key|jwt|login required)\b/i;
const REQUEST_LABEL_RE = /\b(request|body|payload|input|params)\b/i;
const RESPONSE_LABEL_RE = /\b(response|returns?|output|result|reply|sample output)\b/i;

function pathFromUrl(url: string): string | null {
  if (url.startsWith('/')) return url.replace(/[),.;]+$/, '');
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname) + (u.search ? decodeURIComponent(u.search) : '');
    return path || '/';
  } catch {
    return null;
  }
}

function cleanDescription(text: string): string | null {
  const t = collapseWhitespace(text).replace(/^[\s:\-–—|#]+/, '').trim();
  return t ? truncate(t, 300) : null;
}

function authFrom(...texts: (string | null | undefined)[]): boolean | null {
  return texts.some((t) => t && AUTH_RE.test(t)) ? true : null;
}

interface Collected {
  endpoints: ApiEndpoint[];
  index: Map<string, ApiEndpoint>;
}

function add(
  c: Collected,
  method: string,
  path: string,
  description: string | null,
  block: Block,
  line: number,
  authText: string | null
): ApiEndpoint | null {
  const m = method.toUpperCase() as HttpMethod;
  // "`PATCH /items/:id`: update" loses the backtick boundary in plain text; drop trailing punctuation.
  const p = path.trim().replace(/[:,.;)]+$/, '');
  if (!p.startsWith('/')) return null;
  const key = `${m} ${p}`;
  const existing = c.index.get(key);
  if (existing) {
    if (!existing.description && description) existing.description = description;
    if (existing.authRequired === null) existing.authRequired = authFrom(authText, description);
    return existing;
  }
  const source = refFor(block);
  source.line = line || block.line;
  const ep: ApiEndpoint = {
    method: m,
    path: p,
    description,
    requestExample: null,
    responseExample: null,
    authRequired: authFrom(authText, description),
    source,
  };
  c.endpoints.push(ep);
  c.index.set(key, ep);
  return ep;
}

const METHOD_HEADER_RE = /^(method|verb|http method|type)$/i;
const PATH_HEADER_RE = /(endpoint|path|route|url|uri)/i;
const DESC_HEADER_RE = /(description|purpose|summary|action|details|notes?)/i;
const AUTH_HEADER_RE = /(auth|protected|access)/i;

function cell(row: TableRow, i: number): string {
  const c = row.children[i];
  return c ? collapseWhitespace(mdastToString(c)) : '';
}

function fromTable(c: Collected, table: Table, block: Block): ApiEndpoint[] {
  const [header, ...rows] = table.children;
  if (!header) return [];
  const headers = header.children.map((h) => collapseWhitespace(mdastToString(h)).replace(/[*_`]/g, ''));
  const methodIdx = headers.findIndex((h) => METHOD_HEADER_RE.test(h.trim()));
  const pathIdx = headers.findIndex((h, i) => i !== methodIdx && PATH_HEADER_RE.test(h));
  const descIdx = headers.findIndex((h, i) => i !== methodIdx && i !== pathIdx && DESC_HEADER_RE.test(h));
  const authIdx = headers.findIndex((h, i) => i !== methodIdx && i !== pathIdx && AUTH_HEADER_RE.test(h));
  const found: ApiEndpoint[] = [];

  for (const row of rows) {
    let method: string | null = null;
    let path: string | null = null;
    if (methodIdx !== -1 && pathIdx !== -1) {
      method = cell(row, methodIdx).toUpperCase();
      path = cell(row, pathIdx).replace(/`/g, '');
    } else {
      // "GET /users" written in one cell
      for (let i = 0; i < row.children.length; i++) {
        const m = METHOD_LINE_RE.exec(cell(row, i));
        if (m) {
          method = m[1]!;
          path = m[2]!;
          break;
        }
      }
    }
    if (!method || !path || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) continue;
    const desc = descIdx !== -1 ? cleanDescription(cell(row, descIdx)) : null;
    let authText: string | null = null;
    if (authIdx !== -1) {
      const a = cell(row, authIdx).toLowerCase();
      authText = /^(yes|y|true|required|✓|✔|✅|🔒)/.test(a) ? 'auth' : null;
    }
    const ep = add(c, method, path.split(/\s/)[0]!, desc, block, lineOf(row), authText);
    if (ep) found.push(ep);
  }
  return found;
}

function fromCode(c: Collected, code: Code, block: Block): ApiEndpoint[] {
  const found: ApiEndpoint[] = [];
  const firstLine = (code.position?.start.line ?? block.line) + 1;
  const lines = code.value.split('\n');
  lines.forEach((line, offset) => {
    const m = METHOD_LINE_RE.exec(line);
    if (m) {
      const trailing = (m[3] ?? '').replace(/^\s*(#|\/\/|--|-|:)\s*/, '');
      const ep = add(c, m[1]!, m[2]!, cleanDescription(trailing), block, firstLine + offset, line);
      if (ep) found.push(ep);
      return;
    }
    const curl = CURL_RE.exec(line);
    if (curl) {
      const path = pathFromUrl(curl[2]!);
      if (path) {
        const ep = add(c, curl[1]!, path, null, block, firstLine + offset, line);
        if (ep) found.push(ep);
      }
      return;
    }
    const curlUrl = CURL_URL_RE.exec(line);
    if (curlUrl) {
      const path = pathFromUrl(curlUrl[1]!);
      if (block.section !== 'api' && !/(?:^|\/)api(?:\/|$)|\/v\d+(?:\/|$)/i.test(path ?? '')) return;
      const method = /(?:^|\s)(?:-d|--data(?:-raw|-binary)?)(?:\s|=)/i.test(line) ? 'POST' : 'GET';
      if (path) {
        const ep = add(c, method, path, null, block, firstLine + offset, line);
        if (ep) found.push(ep);
      }
    }
  });
  return found;
}

function textLines(node: RootContent): { text: string; line: number }[] {
  if (node.type === 'list') {
    return (node as List).children.map((item) => ({ text: mdastToString(item.children[0] ?? item), line: lineOf(item) }));
  }
  if (node.type === 'paragraph' || node.type === 'heading') {
    const line = lineOf(node);
    return mdastToString(node)
      .split('\n')
      .map((text, i) => ({ text, line: line + i }));
  }
  return [];
}

function isJsonLike(code: Code): boolean {
  const lang = (code.lang ?? '').toLowerCase();
  if (['json', 'jsonc', 'json5', 'javascript', 'js', 'ts', 'http'].includes(lang)) return /^\s*[[{]/.test(code.value) || lang.startsWith('json');
  return lang === '' && /^\s*[[{]/.test(code.value);
}

export function extractApiEndpoints(ctx: DocContext): ApiEndpoint[] {
  const c: Collected = { endpoints: [], index: new Map() };
  let last: ApiEndpoint[] = [];
  let label = '';

  for (const block of ctx.blocks) {
    const inApi = block.section === 'api';
    const node = block.node;

    if (!inApi) {
      // Outside API sections only code blocks are read.
      if (node.type === 'code') fromCode(c, node as Code, block);
      last = [];
      continue;
    }

    if (node.type === 'code') {
      const code = node as Code;
      const found = fromCode(c, code, block);
      if (found.length > 0) {
        last = found;
        label = '';
        continue;
      }
      if (last.length > 0 && isJsonLike(code)) {
        const tag = `${label} ${code.meta ?? ''}`;
        const target = last[last.length - 1]!;
        if (RESPONSE_LABEL_RE.test(tag) && !target.responseExample) target.responseExample = code.value.trim();
        else if (REQUEST_LABEL_RE.test(tag) && !target.requestExample) target.requestExample = code.value.trim();
      }
      continue;
    }

    if (node.type === 'table') {
      const found = fromTable(c, node as Table, block);
      if (found.length > 0) last = found;
      continue;
    }

    const lines = block.isHeading ? [{ text: block.headingText ?? '', line: block.line }] : textLines(node);
    const foundHere: ApiEndpoint[] = [];
    for (const { text, line } of lines) {
      const m = METHOD_LINE_RE.exec(text);
      if (!m) continue;
      const desc = cleanDescription(m[3] ?? '');
      const ep = add(c, m[1]!, m[2]!, desc, block, line, text);
      if (ep) foundHere.push(ep);
    }
    if (foundHere.length > 0) {
      last = foundHere;
      label = '';
      continue;
    }

    // A paragraph right after a heading endpoint is its description; it is also the label for the next code block.
    if (node.type === 'paragraph') {
      const text = collapseWhitespace(mdastToString(node));
      label = text;
      const target = last.length === 1 ? last[0]! : null;
      if (target) {
        // Short "Response:" / "Request body:" lines are labels for the next code block, not descriptions.
        const isLabel =
          /:\s*$/.test(text) || /^(example\s+|sample\s+)?(request|response|body|payload|output|result)s?(\s+(body|example))?\.?$/i.test(text);
        if (!target.description && !isLabel) {
          target.description = cleanDescription(text);
        }
        if (target.authRequired === null) target.authRequired = authFrom(text);
      }
    } else if (block.isHeading) {
      label = block.headingText ?? '';
    }
  }

  return c.endpoints;
}

/** Signals that the project exposes an HTTP API (used by health check H14). */
export function hasApiSignals(ctx: DocContext): boolean {
  if (ctx.sections.some((s) => s.ownType === 'api')) return true;
  for (const block of ctx.blocks) {
    const text = block.isHeading ? block.headingText ?? '' : block.node.type === 'code' ? (block.node as Code).value : blockText(block.node);
    if (/(^|\n)\s*`?(GET|POST|PUT|PATCH|DELETE)\s+\/\S*/.test(text)) return true;
    if (/\b(REST(ful)? API|GraphQL API|API endpoints?|HTTP endpoints?)\b/i.test(text)) return true;
  }
  return false;
}
