import type { Element, ElementContent, Text } from 'hast';

/**
 * GitHub alerts:
 *   > [!NOTE]
 *   > Useful information.
 * The marker must be alone on the first line of the blockquote.
 * Runs AFTER sanitisation, so the classes added here are trusted.
 */

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const MARKER_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

const TITLES: Record<AlertType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function firstElementChild(el: Element): Element | null {
  for (const child of el.children) {
    if (child.type === 'element') return child;
    if (child.type === 'text' && child.value.trim() !== '') return null;
  }
  return null;
}

/**
 * If `el` is a blockquote that starts with an alert marker, mutate it into an alert
 * container and return the alert type. Otherwise return null and leave it untouched.
 */
export function transformAlert(el: Element): AlertType | null {
  if (el.tagName !== 'blockquote') return null;
  const p = firstElementChild(el);
  if (!p || p.tagName !== 'p') return null;
  const first = p.children[0];
  if (!first || first.type !== 'text') return null;
  const match = MARKER_RE.exec(first.value);
  if (!match) return null;
  // A marker followed by more inline content on the same line is not an alert (GitHub behaviour).
  if (!match[0].endsWith('\n') && p.children.length > 1) {
    const next = p.children[1]!;
    const isLineBreak =
      (next.type === 'element' && next.tagName === 'br') ||
      (next.type === 'text' && next.value.startsWith('\n'));
    if (!isLineBreak) return null;
  }
  const rest = first.value.slice(match[0].length);

  const type = match[1]!.toLowerCase() as AlertType;
  (first as Text).value = rest.replace(/^\n/, '');

  // Drop a leading <br> left behind and remove the paragraph if it became empty.
  while (p.children.length > 0) {
    const head = p.children[0]!;
    if (head.type === 'text' && head.value.trim() === '') {
      p.children.shift();
      continue;
    }
    if (head.type === 'element' && head.tagName === 'br') {
      p.children.shift();
      continue;
    }
    break;
  }
  if (p.children.length === 0) {
    el.children = el.children.filter((c) => c !== p);
  }

  const title: Element = {
    type: 'element',
    tagName: 'p',
    properties: { className: ['markdown-alert-title'], dataAlertTitle: type },
    children: [{ type: 'text', value: TITLES[type] }],
  };

  el.tagName = 'div';
  el.properties = {
    ...el.properties,
    className: ['markdown-alert', `markdown-alert-${type}`],
    dataAlert: type,
    role: 'note',
  };
  el.children = [title, ...(el.children as ElementContent[])];
  return type;
}
