import type { Code, Html, Image, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';
import type { CommandItem, DeploymentInfo, Evidenced } from '../types';
import type { DocContext } from './context';
import { blockText, blocksIn, refFor } from './context';
import { TECH_DICTIONARY } from './techDictionary';
import { cleanItemText, collapseWhitespace, stripHtml, truncate, wholeWordRegExp } from '../util/text';

/**
 * Deployment extractor (Extractor spec 4.9, P1).
 * - Platforms: cloud and devops technologies named inside the Deployment section,
 *   deploy buttons anywhere (Vercel, Netlify, Heroku, Railway, Render), and platforms
 *   implied by deploy-category commands.
 * - Steps: list items in the Deployment section.
 */

const PLATFORM_ENTRIES = TECH_DICTIONARY.filter((e) => e.category === 'cloud' || e.category === 'devops');

const COMPILED = PLATFORM_ENTRIES.map((e) => ({
  name: e.name,
  res: [...e.aliases.map((a) => wholeWordRegExp(a, 'i')), ...(e.strict ?? []).map((s) => wholeWordRegExp(s, ''))],
  commands: e.commands ?? [],
}));

const DEPLOY_BUTTONS: [RegExp, string][] = [
  [/vercel\.com\/(new\/clone|button|import)/i, 'Vercel'],
  [/app\.netlify\.com\/start\/deploy|netlify\.com\/img\/deploy\/button/i, 'Netlify'],
  [/heroku\.com\/deploy|herokucdn\.com\/deploy\/button/i, 'Heroku'],
  [/railway\.app\/(new|button|template)/i, 'Railway'],
  [/render\.com\/(deploy|images\/deploy-to-render-button)/i, 'Render'],
  [/deploy\.cloud\.run|cloud\.google\.com\/run/i, 'Google Cloud Run'],
  [/deploy\.workers\.cloudflare\.com/i, 'Cloudflare'],
];

function textOf(node: RootContent): string {
  if (node.type === 'code') return (node as Code).value;
  if (node.type === 'html') return stripHtml((node as Html).value);
  return blockText(node);
}

export function extractDeployment(ctx: DocContext, commands: CommandItem[]): DeploymentInfo {
  const platforms: string[] = [];
  const addPlatform = (name: string) => {
    if (!platforms.includes(name)) platforms.push(name);
  };
  const steps: Evidenced<string>[] = [];
  const seenSteps = new Set<string>();

  for (const block of blocksIn(ctx, 'deployment')) {
    const text = collapseWhitespace(block.isHeading ? block.headingText ?? '' : textOf(block.node));
    for (const p of COMPILED) {
      if (p.res.some((re) => re.test(text))) addPlatform(p.name);
    }
    if (!block.isHeading && block.node.type === 'list') {
      for (const item of block.node.children) {
        const value = truncate(cleanItemText(blockText(item)), 300);
        if (value.length < 2 || seenSteps.has(value)) continue;
        seenSteps.add(value);
        steps.push({ value, source: refFor(block, item), confidence: 'explicit' });
      }
    }
  }

  // Deploy buttons anywhere in the README.
  for (const block of ctx.blocks) {
    const urls: string[] = [];
    visit(block.node, (node, _i, parent) => {
      if (node.type === 'image') {
        urls.push((node as Image).url);
        if (parent && parent.type === 'link') urls.push((parent as { url: string }).url);
      } else if (node.type === 'link') {
        urls.push((node as { url: string }).url);
      } else if (node.type === 'html') {
        for (const m of (node as Html).value.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) urls.push(m[1]!);
      }
    });
    for (const url of urls) {
      for (const [re, name] of DEPLOY_BUTTONS) if (re.test(url)) addPlatform(name);
    }
  }

  // Platforms implied by deploy commands.
  for (const cmd of commands) {
    if (cmd.category !== 'deploy') continue;
    for (const p of COMPILED) {
      if (p.commands.some((re) => re.test(cmd.command))) addPlatform(p.name);
    }
  }

  return { platforms, steps };
}
