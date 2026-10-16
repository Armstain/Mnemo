import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// App-wide choices the person makes once (in onboarding or Settings) and
// that the capture pipeline reads outside React. One small store, read
// synchronously after `loadPreferences()` has run at startup.

/** 'gemini': use the person's own key. 'offline': everything stays on the phone. 'unset': not chosen yet. */
export type AiMode = 'gemini' | 'offline' | 'unset';
/**
 * The language voice notes are heard in. Starts from the phone's own
 * language; switched with one tap while recording (see SpeechLangSwitch)
 * and kept for next time.
 */
export type SpeechLang = 'en-US' | 'bn-BD';

export interface Preferences {
  aiMode: AiMode;
  speechLang: SpeechLang;
  /** What Home greets them by. Empty: no name. */
  name: string;
}

/** Long enough for most first names, short enough for the greeting to fit. */
export const NAME_MAX = 20;

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

const KEY = 'mnemo-preferences';
function phoneLanguage(): SpeechLang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('bn') ? 'bn-BD' : 'en-US';
  } catch {
    return 'en-US';
  }
}

const DEFAULTS: Preferences = { aiMode: 'unset', speechLang: phoneLanguage(), name: '' };

let current: Preferences = DEFAULTS;
const listeners = new Set<() => void>();

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return AsyncStorage.getItem(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, value);
    return;
  }
  await AsyncStorage.setItem(KEY, value);
}

/**
 * Reads saved preferences once at startup. `hasKey` lets installs from
 * before this setting existed keep using AI if they had already added a key.
 */
export async function loadPreferences(hasKey: boolean): Promise<Preferences> {
  try {
    const raw = await read();
    const saved = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    current = { ...DEFAULTS, ...saved };
    current.name = cleanName(typeof current.name === 'string' ? current.name : '');
    if (current.aiMode === 'unset' && hasKey) current.aiMode = 'gemini';
  } catch {
    current = { ...DEFAULTS, aiMode: hasKey ? 'gemini' : 'unset' };
  }
  listeners.forEach((l) => l());
  return current;
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(update: Partial<Preferences>): void {
  current = { ...current, ...update };
  listeners.forEach((l) => l());
  write(JSON.stringify(current)).catch(() => {
    // Kept in memory for this session; saved again on the next change.
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
