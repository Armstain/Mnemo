import { useCallback, useEffect, useState } from 'react';
import { Uniwind, useUniwind } from 'uniwind';

import { secureStorage } from '@/lib/storage';
import { PALETTE, type ThemeColors } from '@/utils/palette';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_PREF_KEY = 'mnemo-theme-preference';

export function useThemeName(): 'light' | 'dark' {
  const { theme } = useUniwind();
  return theme === 'dark' ? 'dark' : 'light';
}

export function useThemeColors(): ThemeColors {
  return PALETTE[useThemeName()];
}

async function readStoredPreference(): Promise<ThemePreference | null> {
  try {
    const raw = await secureStorage.get(THEME_PREF_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Storage unavailable: fall through to system.
  }
  return null;
}

/** Call once from the root layout, before screens render, so the first frame is already in the right theme. */
export async function applyStoredThemePreference(): Promise<void> {
  const pref = await readStoredPreference();
  if (pref && pref !== 'system') {
    Uniwind.setTheme(pref);
  }
}

/** Applying goes through Uniwind, which also syncs RN's Appearance. */
export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let mounted = true;
    readStoredPreference().then((pref) => {
      if (mounted && pref) setPreferenceState(pref);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    Uniwind.setTheme(pref);
    secureStorage.set(THEME_PREF_KEY, pref).catch(() => {
      // Non-critical: the preference just won't survive a restart.
    });
  }, []);

  return { preference, setPreference };
}
