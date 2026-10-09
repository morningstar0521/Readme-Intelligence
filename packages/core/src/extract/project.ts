import type { Html, Image, Link, Paragraph, PhrasingContent, RootContent, Blockquote } from 'mdast';
import { visit } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Badge, Evidenced, ProjectInfo, SourceInfo } from '../types';
import type { Block, DocContext } from './context';
import { refFor, lineOf } from './context';
import { collapseWhitespace, stripEmoji, stripHtml, truncate } from '../util/text';

/**
 * Project info extractor (Extractor spec 4.2).
 * - Name: first h1 text; else the repo name from the source; else null.
 * - Description: first non-badge, non-image paragraph after the h1 (or a blockquote),
 *   within the intro / overview part of the README. Max 300 characters.
 * - Badges: images whose URL matches a known badge host.
 */

const BADGE_URL_RE =
  /(^|\/\/)(img\.)?shields\.io\/|badgen\.net\/|badge\.fury\.io\/|codecov\.io\/.*(badge|graph)|travis-ci\.(org|com)\/.*\.svg|circleci\.com\/.*(badge|\.svg)|github\.com\/[^/]+\/[^/]+\/(actions\/)?workflows\/[^?]*badge\.svg|\/badge\.svg(\?|$)|\/badges?\/|coveralls\.io\/repos\/.*badge|snyk\.io\/test\/.*badge|sonarcloud\.io\/api\/project_badges|readthedocs\.org\/projects\/[^/]+\/badge|pepy\.tech\/badge|goreportcard\.com\/badge|codeclimate\.com\/.*\/badges|deepscan\.io\/api\/.*badge|app\.netlify\.com\/sites\/[^/]+\/deploy-status|vercel\.com\/button|deploy-badge|herokucdn\.com\/deploy\/button|railway\.app\/button\.svg|render\.com\/images\/deploy-to-render-button|discord(app)?\.com\/api\/guilds\/[^/]+\/widget|img\.badgesize\.io|nodei\.co\/npm\/|npmjs\.(com|org)\/.*badge|forthebadge\.com|repobeats\.axiom\.co|starchart\.cc|api\.star-history\.com|komarev\.com\/ghpvc|visitor-badge|hits\.seeyoufarm\.com/i;

export function isBadgeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return BADGE_URL_RE.test(url);
}

/** A paragraph that contains only images (or links wrapping images), breaks and whitespace. */
function isMediaOnly(children: PhrasingContent[]): boolean {
  let hasMedia = false;
  for (const child of children) {
    if (child.type === 'image' || child.type === 'imageReference') {
      hasMedia = true;
      continue;
    }
    if (child.type === 'link' || child.type === 'linkReference') {
      const inner = (child as Link).children;
      if (inner.length > 0 && inner.every((c) => c.type === 'image' || c.type === 'imageReference' || (c.type === 'text' && c.value.trim() === ''))) {
        hasMedia = true;
        continue;
      }
      return false;
    }
    if (child.type === 'break') continue;
    if (child.type === 'text' && child.value.trim() === '') continue;
    if (child.type === 'text' && /^[\s|•·-]*$/.test(child.value)) continue;
    if (child.type === 'html') continue;
    return false;
  }
  return hasMedia || children.length === 0;
}

/** Text content of an HTML block, if it is a text paragraph (no images) of reasonable length. */
function htmlParagraphText(html: Html): string | null {
  const value = html.value;
  if (/<img\b|<picture\b|<h[1-6]\b|<table\b|<details\b/i.test(value)) return null;
  const text = stripHtml(value);
  return text.length >= 20 ? text : null;
}

function cleanDescription(text: string): string {
  return truncate(collapseWhitespace(stripEmoji(text)).replace(/^[>\s]+/, ''), 300);
}

function findName(ctx: DocContext, source: SourceInfo): Evidenced<string> | null {
  const titleBlock = ctx.blocks.find((b) => b.isHeading && b.headingDepth === 1);
  if (titleBlock && titleBlock.headingText) {
    const value = collapseWhitespace(stripEmoji(titleBlock.headingText));
    if (value) return { value, source: refFor(titleBlock), confidence: 'explicit' };
  }
  if (source.kind === 'github') {
    return { value: source.repo, source: { headingPath: [], line: 1 }, confidence: 'inferred-rule' };
  }
  return null;
}

/** Blocks considered part of the intro: before the first non-title heading, or inside an overview section. */
function introBlocks(ctx: DocContext): Block[] {
  const out: Block[] = [];
  let pastIntro = false;
  for (const b of ctx.blocks) {
    if (b.isHeading) {
      if (b.headingDepth === 1 && b.line === ctx.titleLine) continue;
      pastIntro = true;
    }
    if (!pastIntro || b.section === 'overview') out.push(b);
  }
  return out;
}

function findDescription(ctx: DocContext): Evidenced<string> | null {
  for (const block of introBlocks(ctx)) {
    if (block.isHeading) continue;
    const node: RootContent = block.node;
    if (node.type === 'paragraph') {
      const p = node as Paragraph;
      if (isMediaOnly(p.children)) continue;
      const text = cleanDescription(mdastToString(p));
      if (text.length < 2) continue;
      return { value: text, source: refFor(block, p), confidence: 'explicit' };
    }
    if (node.type === 'blockquote') {
      const firstP = (node as Blockquote).children.find((c) => c.type === 'paragraph') as Paragraph | undefined;
      if (!firstP || isMediaOnly(firstP.children)) continue;
      const raw = mdastToString(firstP);
      if (/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(raw)) continue;
      const text = cleanDescription(raw);
      if (text.length < 2) continue;
      return { value: text, source: refFor(block, firstP), confidence: 'explicit' };
    }
    if (node.type === 'html') {
      const text = htmlParagraphText(node as Html);
      if (text) return { value: cleanDescription(text), source: refFor(block), confidence: 'explicit' };
    }
  }
  return null;
}

function findBadges(ctx: DocContext): Badge[] {
  const badges: Badge[] = [];
  const seen = new Set<string>();
  const add = (alt: string, imageUrl: string, line: number, linkUrl?: string) => {
    if (!isBadgeUrl(imageUrl) || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    const badge: Badge = { alt: collapseWhitespace(alt), imageUrl, line };
    if (linkUrl) badge.linkUrl = linkUrl;
    badges.push(badge);
  };

  for (const block of ctx.blocks) {
    visit(block.node, (node, _index, parent) => {
      if (node.type === 'image') {
        const img = node as Image;
        const linkUrl = parent && parent.type === 'link' ? (parent as Link).url : undefined;
        add(img.alt ?? '', img.url, lineOf(img) || block.line, linkUrl);
      } else if (node.type === 'html') {
        const value = (node as Html).value;
        // <a href="..."><img src="..." alt="..."></a>
        const re = /(?:<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*)?<img\b([^>]*)>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(value)) !== null) {
          const attrs = m[2] ?? '';
          const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
          const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
          if (src) add(alt, src, lineOf(node) || block.line, m[1]);
        }
      }
    });
  }
  return badges;
}

/** Count of images that are not badges (screenshots, logos, diagrams). Used by the health scorer. */
export function countNonBadgeImages(ctx: DocContext): number {
  let count = 0;
  for (const block of ctx.blocks) {
    visit(block.node, (node) => {
      if (node.type === 'image') {
        if (!isBadgeUrl((node as Image).url)) count++;
      } else if (node.type === 'html') {
        const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec((node as Html).value)) !== null) {
          if (!isBadgeUrl(m[1])) count++;
        }
      }
    });
  }
  return count;
}

export function extractProjectInfo(ctx: DocContext, source: SourceInfo): ProjectInfo {
  return {
    name: findName(ctx, source),
    description: findDescription(ctx),
    badges: findBadges(ctx),
  };
}
