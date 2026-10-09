import type { List, ListItem, Table, RootContent } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Evidenced } from '../types';
import type { Block, DocContext } from './context';
import { blockText, blocksIn, refFor, lineOf } from './context';
import { cleanItemText, collapseWhitespace, truncate } from '../util/text';

/**
 * Features extractor (Extractor spec 4.3).
 * - List items under a Features section (nested lists flattened one level).
 * - Tables whose first column header is "Feature(s)".
 * - Fallback: sub-headings directly under a Features section that has no list or table.
 * - No Features section => [] (features are never inferred from other text).
 */

const MAX_FEATURE_LENGTH = 200;

/** Text of a list item without its nested lists. */
function itemOwnText(item: ListItem): string {
  const parts: string[] = [];
  for (const child of item.children) {
    if (child.type === 'list') continue;
    parts.push(blockText(child));
  }
  return collapseWhitespace(parts.join(' '));
}

function pushFeature(out: Evidenced<string>[], seen: Set<string>, text: string, block: Block, node?: { position?: { start: { line: number } } }) {
  const value = truncate(cleanItemText(text), MAX_FEATURE_LENGTH);
  if (value.length < 2) return;
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ value, source: refFor(block, node), confidence: 'explicit' });
}

function featuresFromList(list: List, block: Block, out: Evidenced<string>[], seen: Set<string>): void {
  for (const item of list.children) {
    pushFeature(out, seen, itemOwnText(item), block, item);
    // Flatten one level of nesting.
    for (const child of item.children) {
      if (child.type !== 'list') continue;
      for (const nested of child.children) pushFeature(out, seen, itemOwnText(nested), block, nested);
    }
  }
}

function featuresFromTable(table: Table, block: Block, out: Evidenced<string>[], seen: Set<string>): void {
  const [header, ...rows] = table.children;
  if (!header) return;
  const firstHeader = collapseWhitespace(mdastToString(header.children[0] ?? { type: 'text', value: '' }));
  if (!/^features?$/i.test(firstHeader.replace(/[*_`]/g, '').trim())) return;
  for (const row of rows) {
    const cell = row.children[0];
    if (!cell) continue;
    pushFeature(out, seen, mdastToString(cell), block, row);
  }
}

export function extractFeatures(ctx: DocContext): Evidenced<string>[] {
  const out: Evidenced<string>[] = [];
  const seen = new Set<string>();
  const blocks = blocksIn(ctx, 'features');
  if (blocks.length === 0) return [];

  let foundStructured = false;
  for (const block of blocks) {
    const node: RootContent = block.node;
    if (node.type === 'list') {
      foundStructured = true;
      featuresFromList(node, block, out, seen);
    } else if (node.type === 'table') {
      const before = out.length;
      featuresFromTable(node, block, out, seen);
      if (out.length > before) foundStructured = true;
    }
  }

  if (!foundStructured) {
    // Features written as sub-headings ("### Fast", "### Typed").
    for (const block of blocks) {
      if (!block.isHeading || !block.headingText) continue;
      const parentIsFeatures = block.sectionStack.length >= 2 && block.sectionStack[block.sectionStack.length - 2] === 'features';
      if (parentIsFeatures) pushFeature(out, seen, block.headingText, block, { position: { start: { line: lineOf(block.node) } } });
    }
  }

  return out;
}
