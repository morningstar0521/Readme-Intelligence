'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { SourceInfoSchema, type SourceInfo } from '@readme-intel/core';

/**
 * Browser storage helpers. Every access is wrapped in try/catch: storage can be
 * unavailable (private windows, blocked site data) and the app must still work.
 */

export function readLocal<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in-memory state only */
  }
}

/** useState that persists to localStorage (read after mount to avoid hydration mismatch). */
export function usePersistentState<T>(key: string, schema: z.ZodType<T>, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    setValue(readLocal(key, schema, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        writeLocal(key, next);
        return next;
      });
    },
    [key]
  );
  return [value, set];
}

// ------------------------------------------------------------------ local document store

/**
 * Local files and pasted Markdown never leave the browser. They are passed from the
 * landing page to the viewer through sessionStorage (same tab only) with an in-memory
 * fallback when storage is blocked.
 */
const DOC_KEY = 'rid:doc';

const StoredDocSchema = z.object({ markdown: z.string(), source: SourceInfoSchema });
export type StoredDoc = { markdown: string; source: SourceInfo };

let memoryDoc: StoredDoc | null = null;

export function saveDoc(doc: StoredDoc): void {
  memoryDoc = doc;
  try {
    window.sessionStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    /* quota or blocked storage: memory copy is used for this navigation */
  }
}

export function loadDoc(): StoredDoc | null {
  if (memoryDoc) return memoryDoc;
  try {
    const raw = window.sessionStorage.getItem(DOC_KEY);
    if (!raw) return null;
    const parsed = StoredDocSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    memoryDoc = parsed.data as StoredDoc;
    return memoryDoc;
  } catch {
    return null;
  }
}
