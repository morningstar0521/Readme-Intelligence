import type { List, ListItem, Paragraph, RootContent, Code } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { CommandItem, Evidenced, InstallStep } from '../types';
import type { Block, DocContext } from './context';
import { blockText, blocksIn, refFor, lineOf } from './context';
import { commandsInNode, isCommandBlock } from './commands';
import { cleanItemText, collapseWhitespace, truncate } from '../util/text';

/**
 * Prerequisites and install steps (Extractor spec 4.6).
 *
 * Prerequisites: list items in a Prerequisites section, plus lines matching
 * "<tool> <version>" (Node.js 18+, Python >= 3.10, PostgreSQL 14) in Prerequisites
 * or Installation sections.
 *
 * Install steps, inside Installation sections, in document order:
 * - each ordered-list item is a step (commands from code / inline code inside it);
 * - each sub-heading (h3/h4) followed by a code block is a step;
 * - a code block that is not attached to an open step becomes its own step,
 *   titled by the paragraph just before it ("Install dependencies:").
 * Fallback: no Installation section but setup commands elsewhere => one
 * "Inferred install steps" group with confidence "inferred-rule".
 */

const TOOL_NAMES =
  'node(?:\\.js)?|nodejs|npm|yarn|pnpm|bun|deno|python(?:3)?|pip|java|jdk|openjdk|go|golang|rust|rustc|cargo|docker(?: compose)?|docker-compose|postgres(?:ql)?|mysql|mariadb|mongodb|redis|ruby|php|composer|\\.net|dotnet|git|flutter|dart|xcode|android studio|kubectl|kubernetes|terraform|gcc|clang|cmake|make|maven|gradle|elixir|erlang|swift|kotlin|conda|anaconda|poetry|uv|cuda';

const TOOL_VERSION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${TOOL_NAMES})(?![\\p{L}\\p{N}])[\\s:,(]*(?:v(?:ersion)?\\s*)?(?:>=|≥|>|\\^|~|=)?\\s*\\d+(?:\\.\\d+|\\.x)*\\+?|(?<![\\p{L}\\p{N}])(${TOOL_NAMES})(?![\\p{L}\\p{N}])\\s*\\(?(?:lts|latest|or (?:higher|later|newer)|and above)`,
  'iu'
);

/** Short item that is just a tool name ("Docker", "Git"). */
const TOOL_ONLY_RE = new RegExp(`^(${TOOL_NAMES})$`, 'iu');

export function looksLikePrerequisite(text: string): boolean {
  return TOOL_VERSION_RE.test(text) || TOOL_ONLY_RE.test(text.trim());
}

function itemOwnText(item: ListItem): string {
  return collapseWhitespace(
    item.children
      .filter((c) => c.type !== 'list' && c.type !== 'code')
      .map((c) => blockText(c))
      .join(' ')
  );
}

function firstSentence(text: string): string {
  const clean = collapseWhitespace(text);
  const m = /^(.{3,160}?[.:!?])(\s|$)/.exec(clean);
  return truncate((m ? m[1]! : clean).replace(/:$/, ''), 160);
}

export function extractPrerequisites(ctx: DocContext): Evidenced<string>[] {
  const out: Evidenced<string>[] = [];
  const seen = new Set<string>();
  const push = (text: string, block: Block, node?: { position?: { start: { line: number } } }) => {
    const value = truncate(cleanItemText(text), 200);
    if (value.length < 2) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value, source: refFor(block, node), confidence: 'explicit' });
  };

  for (const block of blocksIn(ctx, 'prerequisites')) {
    if (block.isHeading) continue;
    const node = block.node;
    if (node.type === 'list') {
      for (const item of node.children) push(itemOwnText(item), block, item);
    } else if (node.type === 'paragraph') {
      for (const line of mdastToString(node).split('\n')) {
        if (looksLikePrerequisite(line)) push(line, block, node);
      }
    } else if (node.type === 'table') {
      for (const row of node.children.slice(1)) {
        const text = collapseWhitespace(row.children.map((c) => mdastToString(c)).join(' '));
        if (text) push(text, block, row);
      }
    }
  }

  for (const block of blocksIn(ctx, 'installation')) {
    if (block.isHeading) continue;
    const node = block.node;
    if (node.type === 'list' && !node.ordered) {
      for (const item of node.children) {
        const text = itemOwnText(item);
        const hasCode = item.children.some((c) => c.type === 'code');
        if (!hasCode && text.split(/\s+/).length <= 12 && looksLikePrerequisite(text)) push(text, block, item);
      }
    } else if (node.type === 'paragraph') {
      for (const line of mdastToString(node).split('\n')) {
        if (line.split(/\s+/).length <= 14 && TOOL_VERSION_RE.test(line) && /\b(require[sd]?|requirements?|needs?|install(ed)?|prerequisites?|make sure|ensure|have)\b/i.test(line)) {
          push(line, block, node);
        }
      }
    }
  }

  return out;
}

interface StepDraft {
  title: string | null;
  text: string;
  commands: string[];
  line: number;
  block: Block;
  /** Accepts the next code block as its commands. */
  open: boolean;
  /** Ordered list items are always kept, even without commands. */
  keepWithoutCommands: boolean;
}

function commandStrings(node: RootContent): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of commandsInNode(node)) {
    if (!seen.has(c.command)) {
      seen.add(c.command);
      out.push(c.command);
    }
  }
  return out;
}

/** True if the heading block is the root of an Installation section (not a sub-step). */
function isInstallRoot(block: Block): boolean {
  const n = block.sectionStack.length;
  const parent = n >= 2 ? block.sectionStack[n - 2] : null;
  return parent !== 'installation';
}

export function extractInstallSteps(ctx: DocContext, allCommands: CommandItem[]): InstallStep[] {
  const blocks = blocksIn(ctx, 'installation');
  const drafts: StepDraft[] = [];
  let current: StepDraft | null = null;
  /** Step created from a sub-heading: every command until the next heading belongs to it. */
  let headingStep: StepDraft | null = null;
  let pendingTitle: { text: string; line: number } | null = null;

  const mergeInto = (step: StepDraft, cmds: string[]) => {
    for (const c of cmds) if (!step.commands.includes(c)) step.commands.push(c);
    step.open = false;
  };

  const startStep = (draft: Omit<StepDraft, 'block'>, block: Block): StepDraft => {
    const step: StepDraft = { ...draft, block };
    drafts.push(step);
    return step;
  };

  for (const block of blocks) {
    const node = block.node;

    if (block.isHeading) {
      pendingTitle = null;
      headingStep = null;
      if (isInstallRoot(block)) {
        current = null;
        continue;
      }
      current = headingStep = startStep(
        { title: truncate(cleanItemText(block.headingText ?? ''), 160) || null, text: '', commands: [], line: block.line, open: true, keepWithoutCommands: false },
        block
      );
      continue;
    }

    if (node.type === 'list') {
      const list = node as List;
      if (list.ordered) {
        // Numbered items are the steps; the enclosing heading is just a group title.
        headingStep = null;
        for (const item of list.children) {
          const text = itemOwnText(item);
          const step = startStep(
            { title: firstSentence(text) || null, text: truncate(text, 400), commands: commandStrings(item), line: lineOf(item), open: true, keepWithoutCommands: true },
            block
          );
          current = step;
        }
        pendingTitle = null;
        continue;
      }
      // Unordered lists: only items that carry commands are steps.
      for (const item of list.children) {
        const cmds = commandStrings(item);
        if (cmds.length === 0) continue;
        if (headingStep) {
          mergeInto(headingStep, cmds);
          continue;
        }
        const text = itemOwnText(item);
        current = startStep(
          { title: firstSentence(text) || null, text: truncate(text, 400), commands: cmds, line: lineOf(item), open: false, keepWithoutCommands: false },
          block
        );
      }
      pendingTitle = null;
      continue;
    }

    if (node.type === 'code') {
      if (!isCommandBlock(node as Code)) continue;
      const cmds = commandStrings(node);
      if (cmds.length === 0) continue;
      if (headingStep) {
        mergeInto(headingStep, cmds);
      } else if (current && current.open && current.commands.length === 0) {
        current.commands = cmds;
        current.open = false;
      } else {
        current = startStep(
          {
            title: pendingTitle ? pendingTitle.text : null,
            text: pendingTitle ? pendingTitle.text : '',
            commands: cmds,
            line: pendingTitle ? pendingTitle.line : lineOf(node),
            open: false,
            keepWithoutCommands: false,
          },
          block
        );
      }
      pendingTitle = null;
      continue;
    }

    if (node.type === 'paragraph') {
      const text = collapseWhitespace(mdastToString(node as Paragraph));
      const inline = commandStrings(node);
      if (inline.length > 0 && headingStep) {
        mergeInto(headingStep, inline);
        pendingTitle = null;
      } else if (inline.length > 0) {
        current = startStep(
          { title: firstSentence(text) || null, text: truncate(text, 400), commands: inline, line: lineOf(node), open: false, keepWithoutCommands: false },
          block
        );
        pendingTitle = null;
      } else if (text) {
        pendingTitle = { text: firstSentence(text), line: lineOf(node) };
        // A paragraph after a closed step starts a new context.
        if (current && !current.open) current = null;
      }
      continue;
    }
  }

  const steps: InstallStep[] = drafts
    .filter((d) => d.commands.length > 0 || d.keepWithoutCommands)
    .map((d, i) => {
      const source = refFor(d.block);
      source.line = d.line || d.block.line;
      return {
        order: i + 1,
        title: d.title,
        commands: d.commands,
        text: d.text,
        source,
        confidence: 'explicit' as const,
      };
    });

  if (steps.length > 0 || blocks.length > 0) return steps;

  // Fallback: no Installation section at all.
  const setup = allCommands.filter((c) => c.category === 'setup');
  if (setup.length === 0) return [];
  const first = setup[0]!;
  return [
    {
      order: 1,
      title: 'Inferred install steps',
      commands: setup.map((c) => c.command),
      text: 'No installation section was found. These setup commands were found elsewhere in the README.',
      source: { ...first.source, headingPath: [...first.source.headingPath] },
      confidence: 'inferred-rule',
    },
  ];
}
