import type { Paragraph, RootContent } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Badge, Evidenced, LinkItem, ReadmeSignals } from '../types';
import type { DocContext } from './context';
import { blockText, blocksIn, hasSection, refFor } from './context';
import { countNonBadgeImages } from './project';
import { hasApiSignals } from './api';
import { collapseWhitespace, truncate } from '../util/text';

/**
 * License, contributing / testing flags and document-level signals for the health scorer.
 */

const LICENSE_NAME_RE =
  /\b(MIT|Apache(?:[ -]License)?(?:,?\s*(?:Version\s*)?2\.0)?|Apache-2\.0|A?GPL(?:-?v?[23](?:\.0)?(?:-only|-or-later|\+)?)?|LGPL(?:-?v?[23](?:\.[01])?)?|GNU (?:General|Lesser|Affero) Public License(?: v?[23](?:\.0)?)?|BSD(?:[ -][234][ -]Clause)?|ISC|MPL(?:-?2\.0)?|Mozilla Public License(?: 2\.0)?|Unlicense|CC0(?:-1\.0)?|CC[ -]BY(?:-SA|-NC|-ND)*(?:[ -]4\.0)?|Creative Commons[\w\s.-]{0,40}|Boost Software License|zlib|EPL(?:-?2\.0)?|Eclipse Public License|WTFPL|0BSD|BlueOak-1\.0\.0|EUPL(?:-1\.2)?)\b/i;

export function licenseNameIn(text: string): string | null {
  const m = LICENSE_NAME_RE.exec(text);
  return m ? collapseWhitespace(m[1]!) : null;
}

export function extractLicense(ctx: DocContext, links: LinkItem[], badges: Badge[]): Evidenced<string> | null {
  // 1. License section
  const blocks = blocksIn(ctx, 'license');
  for (const block of blocks) {
    if (block.isHeading) continue;
    const text = blockText(block.node);
    if (!text) continue;
    const name = licenseNameIn(text);
    if (name) return { value: name, source: refFor(block), confidence: 'explicit' };
  }
  for (const block of blocks) {
    if (block.isHeading || block.node.type !== 'paragraph') continue;
    const text = collapseWhitespace(mdastToString(block.node as Paragraph));
    if (text) return { value: truncate(text, 120), source: refFor(block), confidence: 'explicit' };
  }
  // 2. Explicit licensing prose outside a dedicated License section.
  for (const block of ctx.blocks) {
    if (block.isHeading) continue;
    const text = blockText(block.node);
    if (!text || !/\b(?:dual[- ]licensed|licensed|licenced|released under|license is)\b/i.test(text)) continue;
    const name = licenseNameIn(text);
    if (name) return { value: name, source: refFor(block), confidence: 'explicit' };
  }
  // 3. A link to a LICENSE file or labelled "license"
  const link = links.find((l) => l.type === 'license');
  if (link) {
    const name = licenseNameIn(link.text) ?? licenseNameIn(link.url);
    return { value: name ?? link.text, source: link.source, confidence: 'explicit' };
  }
  // 4. A license badge
  const badge = badges.find((b) => /licen[cs]e/i.test(b.alt) || /licen[cs]e/i.test(b.imageUrl));
  if (badge) {
    let decoded = badge.imageUrl;
    try {
      decoded = decodeURIComponent(badge.imageUrl);
    } catch {
      /* keep raw */
    }
    const name = licenseNameIn(badge.alt) ?? licenseNameIn(decoded.replace(/[-_]/g, ' '));
    return {
      value: name ?? (badge.alt || 'License badge'),
      source: { headingPath: [], line: badge.line },
      confidence: name ? 'explicit' : 'inferred-rule',
    };
  }
  return null;
}

export function detectContributing(ctx: DocContext, links: LinkItem[]): boolean {
  if (hasSection(ctx, 'contributing')) return true;
  if (links.some((l) => /contributing/i.test(l.url) || /\bcontribut(e|ing|ion)\b/i.test(l.text))) return true;
  // Reference to CONTRIBUTING.md in plain text
  return ctx.blocks.some((b) => !b.isHeading && /CONTRIBUTING(\.md)?\b/.test(blockText(b.node)));
}

export function detectTestsSection(ctx: DocContext): boolean {
  return hasSection(ctx, 'testing');
}

const ENV_USAGE_RE = /(\.env\b|environment variables?|env vars?|process\.env|os\.environ|getenv|dotenv|import\.meta\.env)/i;
const NO_ENV_RE = /\bno (environment variables?|env(ironment)? vars?|\.env( file)?|configuration)\b.{0,40}\b(is |are )?(required|needed|necessary)\b|\b(does not|doesn't|do not|don't) (require|need) (any )?(environment variables?|env vars?|a \.env|configuration)/i;

export function computeSignals(ctx: DocContext): ReadmeSignals {
  const types = new Set(ctx.sections.map((s) => s.ownType).filter((t): t is NonNullable<typeof t> => t !== null));
  let envUsage = false;
  let noEnv = false;
  for (const block of ctx.blocks) {
    const node = block.node as RootContent;
    const text = block.isHeading
      ? block.headingText ?? ''
      : node.type === 'code' || node.type === 'html' || node.type === 'inlineCode'
        ? (node as { value: string }).value
        : blockText(node);
    if (!envUsage && ENV_USAGE_RE.test(text)) envUsage = true;
    if (!noEnv && NO_ENV_RE.test(text)) noEnv = true;
    if (!envUsage && node.type === 'code' && /^(export\s+)?[A-Z][A-Z0-9_]{2,}=/m.test((node as { value: string }).value)) envUsage = true;
  }
  if (types.has('configuration')) envUsage = true;
  return {
    sectionTypes: [...types],
    nonBadgeImageCount: countNonBadgeImages(ctx),
    envUsageMentioned: envUsage,
    statesNoEnvNeeded: noEnv,
    apiSignals: hasApiSignals(ctx),
  };
}
