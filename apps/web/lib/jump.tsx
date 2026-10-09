'use client';

import { createContext, useContext } from 'react';
import { prefersReducedMotion } from './hooks';

/**
 * Jump to source (F-39). Every extracted item carries a 1-based README line.
 * Rendered block elements carry data-line, so we pick the element with the
 * largest line <= target (the deepest one when several share that line),
 * scroll it into view and flash a highlight.
 */

export interface JumpApi {
  jumpToLine: (line: number) => void;
  jumpToAnchor: (id: string) => void;
}

export const JumpContext = createContext<JumpApi>({ jumpToLine: () => undefined, jumpToAnchor: () => undefined });

export function useJump(): JumpApi {
  return useContext(JumpContext);
}

export function findElementForLine(container: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -1;
  for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-line]'))) {
    const l = Number(node.dataset.line);
    if (!Number.isFinite(l) || l > line) continue;
    // Document order: a later node with the same line is nested deeper or comes after; prefer it.
    if (l >= bestLine) {
      best = node;
      bestLine = l;
    }
  }
  return best;
}

export function flash(el: HTMLElement): void {
  el.classList.remove('jump-highlight');
  // Force reflow so the animation restarts when jumping to the same element twice.
  void el.offsetWidth;
  el.classList.add('jump-highlight');
  // Keep the marker on the element after the animation finishes. The final
  // keyframe is transparent, and a later jump removes/re-adds the class to
  // restart the animation. Keeping it mounted also gives automation and
  // assistive tooling a stable target after a jump.
}

export function scrollToElement(el: HTMLElement, highlight = true): void {
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  if (highlight) flash(el);
}

/** Resolve an in-page anchor the way GitHub does (#foo also finds user-content-foo). */
export function findAnchor(id: string): HTMLElement | null {
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  return (
    document.getElementById(decoded) ??
    document.getElementById(decoded.toLowerCase()) ??
    document.getElementById(`user-content-${decoded}`) ??
    document.getElementById(`user-content-${decoded.toLowerCase()}`)
  );
}
