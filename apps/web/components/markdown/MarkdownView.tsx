'use client';

import { Fragment, memo, useMemo, type ComponentPropsWithoutRef, type MouseEvent } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime, type Components, type Jsx } from 'hast-util-to-jsx-runtime';
import { toString as hastToString } from 'hast-util-to-string';
import type { Element, Root } from 'hast';
import { Info, Lightbulb, MessageSquareWarning, TriangleAlert, OctagonAlert } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { SafeImage } from './SafeImage';
import { useJump } from '@/lib/jump';

/**
 * Renders the sanitized hast from @readme-intel/core as React elements.
 * There is no dangerouslySetInnerHTML for README content: the tree is already sanitized
 * and is turned into React elements directly, which also avoids HTML re-parsing (mXSS).
 */

const ALERT_ICONS = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
} as const;

type WithNode<T> = T & { node?: Element };

function languageOf(code: Element | undefined): string | null {
  const cls = code?.properties?.className;
  const list = Array.isArray(cls) ? cls : typeof cls === 'string' ? [cls] : [];
  for (const c of list) {
    const m = /^language-(.+)$/.exec(String(c));
    if (m) return m[1]!;
  }
  return null;
}

function Pre({ node, ...props }: WithNode<ComponentPropsWithoutRef<'pre'>>) {
  const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  const text = code ? hastToString(code) : node ? hastToString(node) : '';
  const lineAttr = (props as Record<string, unknown>)['data-line'];
  return <CodeBlock code={text} lang={languageOf(code)} line={typeof lineAttr === 'number' ? lineAttr : Number(lineAttr) || undefined} />;
}

function Img({ node: _node, ...props }: WithNode<ComponentPropsWithoutRef<'img'>>) {
  const inLink = (props as Record<string, unknown>)['data-in-link'] === 'true';
  return <SafeImage {...props} inLink={inLink} />;
}

function Anchor({ node: _node, href, children, ...props }: WithNode<ComponentPropsWithoutRef<'a'>>) {
  const { jumpToAnchor } = useJump();
  if (href && href.startsWith('#') && href.length > 1) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      jumpToAnchor(href.slice(1));
    };
    return (
      <a {...props} href={href} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <a {...props} href={href}>
      {children}
    </a>
  );
}

function Paragraph({ node: _node, children, ...props }: WithNode<ComponentPropsWithoutRef<'p'>>) {
  const type = (props as Record<string, unknown>)['data-alert-title'] as keyof typeof ALERT_ICONS | undefined;
  const Icon = type ? ALERT_ICONS[type] : undefined;
  return (
    <p {...props}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </p>
  );
}

function Input({ node: _node, ...props }: WithNode<ComponentPropsWithoutRef<'input'>>) {
  // Task-list checkboxes are display-only.
  return <input {...props} readOnly />;
}

const components: Partial<Components> = {
  pre: Pre as Components['pre'],
  img: Img as Components['img'],
  a: Anchor as Components['a'],
  p: Paragraph as Components['p'],
  input: Input as Components['input'],
};

function MarkdownViewInner({ hast }: { hast: Root }) {
  const content = useMemo(
    () =>
      toJsxRuntime(hast, {
        Fragment,
        // React's jsx functions are compatible at runtime; the cast bridges the library's generic types.
        jsx: jsx as unknown as Jsx,
        jsxs: jsxs as unknown as Jsx,
        components,
        passNode: true,
        ignoreInvalidStyle: true,
      }),
    [hast]
  );
  return (
    <article className="markdown-body" data-testid="markdown">
      {content}
    </article>
  );
}

export const MarkdownView = memo(MarkdownViewInner);
