import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Uniwind, useUniwind } from 'uniwind';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREF_KEY = 'mnemo-theme-preference';

/**
 * JS mirror of the CSS tokens in global.css, for the places uniwind
 * classes can't reach: icon `color=` props, inline styles, navigation
 * themes, and the Glass/AmbientGlow material recipes. Keep in sync with
 * global.css.
 */
export const PALETTE = {
  light: {
    bg: '#F2F5F4',
    fg: '#16181D',
    fgSecondary: '#4A4F5B',
    fgTertiary: '#6B7180',
    accent: '#0B7A52',
    accentInk: '#FFFFFF',
    accentWarm: '#C2478A',
    surface: 'rgba(255,255,255,0.55)',
    border: 'rgba(10,15,20,0.12)',
    error: '#C2543C',
    errorInk: '#FFFFFF',
  },
  dark: {
    bg: '#0A0B0F',
    fg: '#F4F5F8',
    fgSecondary: '#A9AEBC',
    fgTertiary: '#7E8494',
    accent: '#34d399',
    accentInk: '#04271B',
    accentWarm: '#F472B6',
    surface: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.12)',
    error: '#F0876C',
    errorInk: '#33100A',
  },
} as const;

export type ThemeColors = (typeof PALETTE)['light' | 'dark'];

/** The active scheme ('light' | 'dark'), reactive to system + manual changes. */
export function useThemeName(): 'light' | 'dark' {
  const { theme } = useUniwind();
  return theme === 'dark' ? 'dark' : 'light';
}

/** The active palette, for icon colors and inline styles. */
export function useThemeColors(): ThemeColors {
  return PALETTE[useThemeName()];
}

async function readStoredPreference(): Promise<ThemePreference | null> {
  try {
    const raw =
      Platform.OS === 'web'
        ? localStorage.getItem(THEME_PREF_KEY)
        : await SecureStore.getItemAsync(THEME_PREF_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Storage unavailable — fall through to system.
  }
  return null;
}

/**
 * Applies the persisted theme preference at app boot. Call once from the
 * root layout, before screens render, so the first frame is already in
 * the right theme.
 */
export async function applyStoredThemePreference(): Promise<void> {
  const pref = await readStoredPreference();
  if (pref && pref !== 'system') {
    Uniwind.setTheme(pref);
  }
}

/**
 * Theme preference state + setter for the Settings screen. Setting a
 * preference applies it immediately (via Uniwind, which also syncs RN's
 * Appearance) and persists it.
 */
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
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(THEME_PREF_KEY, pref);
      } else {
        SecureStore.setItemAsync(THEME_PREF_KEY, pref);
      }
    } catch {
      // Non-critical — preference just won't survive a restart.
    }
  }, []);

  return { preference, setPreference };
}
