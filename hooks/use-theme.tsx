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
    bg: '#F7FAF7', // M3 surface
    fg: '#191C1A', // on-surface
    fgSecondary: '#404943', // on-surface-variant
    fgTertiary: '#707972', // outline
    accent: '#0B7A52', // primary
    accentInk: '#FFFFFF', // on-primary
    accentWarm: '#7D5260', // tertiary
    surface: '#EBF0EB', // surface-container
    surfaceWarm: '#E5EAE5', // surface-container-high
    border: '#C0C9C0', // outline-variant
    error: '#BA1A1A',
    errorInk: '#FFFFFF',
    // Material 3 tonal ramp + containers
    primaryContainer: '#A7F3D0',
    onPrimaryContainer: '#002114',
    surfaceLowest: '#FFFFFF',
    surfaceLow: '#F1F5F1',
    surfaceHigh: '#E5EAE5',
    surfaceHighest: '#DFE4DF',
    outline: '#707972',
  },
  dark: {
    bg: '#101410', // M3 surface (dark)
    fg: '#E1E3DE',
    fgSecondary: '#C0C9C0',
    fgTertiary: '#8A938B',
    accent: '#34d399', // primary (light tone)
    accentInk: '#003824', // on-primary
    accentWarm: '#EFB8C8',
    surface: '#1C211C', // surface-container
    surfaceWarm: '#262B26', // surface-container-high
    border: '#404943', // outline-variant
    error: '#FFB4AB',
    errorInk: '#690005',
    primaryContainer: '#005138',
    onPrimaryContainer: '#A7F3D0',
    surfaceLowest: '#0B0F0B',
    surfaceLow: '#181D18',
    surfaceHigh: '#262B26',
    surfaceHighest: '#313631',
    outline: '#8A938B',
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
