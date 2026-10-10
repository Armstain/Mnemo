import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Uniwind, useUniwind } from 'uniwind';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREF_KEY = 'mnemo-theme-preference';

/**
 * JS mirror of the CSS tokens in global.css, for the places uniwind
 * classes can't reach: icon `color=` props, inline styles, navigation
 * themes, and any surface that needs a runtime-conditional color. Keep in
 * sync with global.css.
 */
export const PALETTE = {
  light: {
    bg: '#FAF8F3',
    fg: '#1C1A15',
    fgSecondary: '#4D4940',
    fgTertiary: '#6B665B',
    accent: '#0D6B4A',
    accentInk: '#FFFFFF',
    accentWarm: '#A4552F', // == hueClay
    accentSoft: 'rgba(13, 107, 74, 0.09)',
    surface: '#F1EDE4',
    surfaceWarm: '#EAE5DA',
    border: '#E0DACC',
    error: '#A52B25',
    errorInk: '#FFFFFF',
    errorSoft: 'rgba(165, 43, 37, 0.09)',
    // Tonal ramp + containers
    primaryContainer: '#CBE9D8',
    onPrimaryContainer: '#06301F',
    surfaceLowest: '#FFFFFF',
    surfaceLow: '#F6F3EC',
    surfaceRaised: '#FFFFFF',
    surfaceHigh: '#EAE5DA',
    surfaceHighest: '#E2DCCF',
    outline: '#B3AC9C',
    hueSage: '#3F7A5A',
    hueClay: '#A4552F',
    hueIndigo: '#4A5C9E',
    hueAmber: '#8A6314',
    huePlum: '#8A4A6E',
    hueTeal: '#1F6F76',
    // Hero — the one inverted surface (resume card): deep ink-green with
    // paper text, so the thread you should pick up is the darkest, most
    // deliberate thing on a light page.
    hero: '#0E3B2B',
    onHero: '#F4F1E8',
    onHeroMuted: 'rgba(244, 241, 232, 0.68)',
    heroSoft: 'rgba(244, 241, 232, 0.10)',
    heroAccent: '#9FE2BF',
  },
  dark: {
    bg: '#121310',
    fg: '#ECE9E0',
    fgSecondary: '#BDBAB0',
    fgTertiary: '#9A978C',
    accent: '#5DDBA0',
    accentInk: '#00301C',
    accentWarm: '#E0A17C', // == hueClay
    accentSoft: 'rgba(93, 219, 160, 0.12)',
    surface: '#1D1F1A',
    surfaceWarm: '#262822',
    border: '#333630',
    error: '#FF9D92',
    errorInk: '#4A0B07',
    errorSoft: 'rgba(255, 157, 146, 0.12)',
    primaryContainer: '#0D4A33',
    onPrimaryContainer: '#A8F0CC',
    surfaceLowest: '#0B0C09',
    surfaceLow: '#17180F',
    surfaceRaised: '#272A23',
    surfaceHigh: '#262822',
    surfaceHighest: '#31332C',
    outline: '#6E6B62',
    hueSage: '#7FC79C',
    hueClay: '#E0A17C',
    hueIndigo: '#9AA9E8',
    hueAmber: '#D7B263',
    huePlum: '#D99EC0',
    hueTeal: '#77C3C9',
    hero: '#163126',
    onHero: '#ECE9E0',
    onHeroMuted: 'rgba(236, 233, 224, 0.66)',
    heroSoft: 'rgba(236, 233, 224, 0.08)',
    heroAccent: '#5DDBA0',
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
