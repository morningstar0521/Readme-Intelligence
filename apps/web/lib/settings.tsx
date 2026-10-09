'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { z } from 'zod';
import { usePersistentState } from './storage';

/** Viewer settings: optional blocking of remote images (Security spec, P1). */
interface Settings {
  blockRemoteImages: boolean;
  setBlockRemoteImages: (v: boolean) => void;
}

const SettingsContext = createContext<Settings>({ blockRemoteImages: false, setBlockRemoteImages: () => undefined });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [blockRemoteImages, setBlockRemoteImages] = usePersistentState('rid-block-images', z.boolean(), false);
  const value = useMemo(() => ({ blockRemoteImages, setBlockRemoteImages }), [blockRemoteImages, setBlockRemoteImages]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  return useContext(SettingsContext);
}
