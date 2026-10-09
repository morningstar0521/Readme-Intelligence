import type { Definition, Html, Image, Link, LinkReference, PhrasingContent } from 'mdast';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { LinkItem, LinkType, SourceInfo } from '../types';
import type { Block, DocContext } from './context';
import { refFor, lineOf } from './context';
import { resolveUrl } from '../render/resolveUrls';
import { isBadgeUrl } from './project';
import { collapseWhitespace, stripHtml, truncate } from '../util/text';

/**
 * Links extractor (Extractor spec 4.10).
 * Collects Markdown links, reference links and <a href> in HTML blocks.
 * Excludes in-page anchors and links that only wrap badge images. Dedupe by URL.
 * Classification order is from most specific to most generic.
 */

const DEMO_HOSTS = /(^|\.)(vercel\.app|netlify\.app|onrender\.com|railway\.app|up\.railway\.app|herokuapp\.com|github\.io|pages\.dev|fly\.dev|web\.app|firebaseapp\.com|surge\.sh|glitch\.me|streamlit\.app|hf\.space)$/i;

export function classifyLink(url: string, text: string): LinkType {
  const u = url.toLowerCase();
  const t = text.toLowerCase();
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    /* relative or mailto */
  }

  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com)$/.test(host)) return 'video';
  if (/(^|\.)(discord\.gg|discord\.com|discordapp\.com|slack\.com|t\.me|telegram\.me|gitter\.im|matrix\.to)$/.test(host)) return 'chat';
  if (/\/issues(\/|$)|\/discussions(\/|$)/.test(path) || /\bissues?\b|\bbug reports?\b/.test(t)) return 'issues';
  if (/licen[cs]e/.test(path) || /\blicen[cs]e\b/.test(t)) return 'license';
  if (/\b(docs|documentation|wiki|api reference|guide)\b/.test(t) || /^docs\.|\.readthedocs\.|readthedocs\.io$|gitbook\.io$/.test(host) || /\/wiki(\/|$)/.test(path)) return 'docs';
  if (/\b(demo|live|try it|website|live site|playground)\b/.test(t) || DEMO_HOSTS.test(host)) return 'demo';
  if ((host === 'github.com' || host === 'gitlab.com' || host === 'bitbucket.org') && /^\/[^/]+\/[^/]+\/?$/.test(path.replace(/\.git$/, ''))) return 'repo';
  if (/^mailto:/.test(u)) return 'other';
  return 'other';
}

function linkText(children: PhrasingContent[]): string {
  const text = collapseWhitespace(mdastToString({ type: 'paragraph', children }));
  if (text) return text;
  const img = children.find((c) => c.type === 'image') as Image | undefined;
  return img?.alt ? collapseWhitespace(img.alt) : '';
}

function wrapsOnlyBadges(children: PhrasingContent[]): boolean {
  const media = children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  return media.length > 0 && media.every((c) => c.type === 'image' && isBadgeUrl((c as Image).url));
}

export function extractLinks(ctx: DocContext, source: SourceInfo): LinkItem[] {
  const definitions = new Map<string, string>();
  for (const block of ctx.blocks) {
    visit(block.node, 'definition', (d: Definition) => {
      definitions.set(d.identifier.toLowerCase(), d.url);
    });
  }

  const out: LinkItem[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, text: string, block: Block, line: number) => {
    if (!rawUrl || rawUrl.trim().startsWith('#')) return;
    const url = resolveUrl(rawUrl, 'link', source) ?? null;
    if (!url || url.startsWith('#')) return;
    if (seen.has(url)) return;
    seen.add(url);
    const ref = refFor(block);
    ref.line = line || block.line;
    const display = truncate(text || url, 160);
    out.push({ url, text: display, type: classifyLink(url, display), source: ref });
  };

  for (const block of ctx.blocks) {
    visit(block.node, (node, index, parent) => {
      if (node.type === 'link') {
        const link = node as Link;
        if (wrapsOnlyBadges(link.children)) return;
        add(link.url, linkText(link.children), block, lineOf(link));
      } else if (node.type === 'linkReference') {
        const ref = node as LinkReference;
        const url = definitions.get(ref.identifier.toLowerCase());
        if (!url || wrapsOnlyBadges(ref.children)) return;
        add(url, linkText(ref.children), block, lineOf(ref));
      } else if (node.type === 'html') {
        const value = (node as Html).value;
        // Inline HTML in a paragraph is split into separate nodes: "<a href>", text, "</a>".
        const open = /^<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>$/i.exec(value.trim());
        if (open && parent && typeof index === 'number') {
          const siblings = (parent as { children: Node[] }).children;
          const inner: Node[] = [];
          for (let j = index + 1; j < siblings.length; j++) {
            const sib = siblings[j]!;
            if (sib.type === 'html' && /^<\/a>$/i.test((sib as Html).value.trim())) break;
            inner.push(sib);
          }
          const innerHtml = inner.map((n) => (n.type === 'html' ? (n as Html).value : '')).join('');
          const imgs = [...innerHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]!);
          const imageNodes = inner.filter((n): n is Image => n.type === 'image');
          const text = collapseWhitespace(inner.filter((n) => n.type !== 'html').map((n) => mdastToString(n)).join(''));
          const allBadges = [...imgs, ...imageNodes.map((i) => i.url)];
          if (!text && allBadges.length > 0 && allBadges.every((src) => isBadgeUrl(src))) return;
          const alt = /<img\b[^>]*\balt\s*=\s*["']([^"']*)["']/i.exec(innerHtml)?.[1] ?? imageNodes[0]?.alt ?? '';
          add(open[1]!, text || alt, block, lineOf(node));
          return;
        }
        for (const m of value.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
          const inner = m[2] ?? '';
          const imgs = [...inner.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]!);
          const text = stripHtml(inner);
          if (!text && imgs.length > 0 && imgs.every((src) => isBadgeUrl(src))) continue;
          const alt = /<img\b[^>]*\balt\s*=\s*["']([^"']*)["']/i.exec(inner)?.[1] ?? '';
          add(m[1]!, text || alt, block, lineOf(node));
        }
      }
    });
  }
  return out;
}
