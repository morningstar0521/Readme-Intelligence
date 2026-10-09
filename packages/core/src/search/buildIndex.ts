import type { Code, RootContent } from 'mdast';
import type { HeadingInfo, Intelligence, SearchEntry } from '../types';
import type { DocContext } from '../extract/context';
import { blockText } from '../extract/context';
import { collapseWhitespace, truncate } from '../util/text';

/**
 * Build the entries for Cmd/Ctrl+K search: headings, paragraphs, code,
 * commands, env vars, tech stack and features. The UI runs Fuse.js over these.
 */
export function buildSearchIndex(ctx: DocContext, headings: HeadingInfo[], intel: Intelligence): SearchEntry[] {
  const entries: SearchEntry[] = [];
  let n = 0;
  const id = (kind: string) => `${kind}-${n++}`;

  for (const h of headings) {
    if (!h.text) continue;
    entries.push({ id: id('section'), kind: 'section', title: h.text, text: h.text, line: h.line, anchor: h.id || undefined });
  }

  for (const block of ctx.blocks) {
    if (block.isHeading) continue;
    const node = block.node as RootContent;
    if (node.type === 'code') {
      const value = (node as Code).value;
      if (!value.trim()) continue;
      entries.push({
        id: id('code'),
        kind: 'code',
        title: truncate(collapseWhitespace(value.split('\n')[0] ?? ''), 80),
        text: truncate(value, 500),
        line: block.line,
        anchor: block.anchor,
      });
      continue;
    }
    if (node.type === 'paragraph' || node.type === 'list' || node.type === 'blockquote' || node.type === 'table') {
      const text = blockText(node);
      if (text.length < 3) continue;
      entries.push({
        id: id('paragraph'),
        kind: 'paragraph',
        title: truncate(text, 80),
        text: truncate(text, 500),
        line: block.line,
        anchor: block.anchor,
      });
    }
  }

  for (const c of intel.commands) {
    entries.push({ id: id('command'), kind: 'command', title: c.command, text: `${c.category} ${c.command}`, line: c.source.line, anchor: c.source.anchor });
  }
  for (const e of intel.envVars) {
    entries.push({ id: id('env'), kind: 'env', title: e.name, text: `${e.name} ${e.description ?? ''}`.trim(), line: e.source.line, anchor: e.source.anchor });
  }
  for (const t of intel.techStack) {
    const ev = t.evidence[0]!;
    entries.push({ id: id('tech'), kind: 'tech', title: t.name, text: `${t.name} ${t.category}`, line: ev.source.line, anchor: ev.source.anchor });
  }
  for (const f of intel.features) {
    entries.push({ id: id('feature'), kind: 'feature', title: truncate(f.value, 80), text: f.value, line: f.source.line, anchor: f.source.anchor });
  }

  return entries;
}
