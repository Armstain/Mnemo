import type { PlaceSound } from '@/lib/place-sound';
import { storage } from '@/lib/storage';
import { createValueStore } from '@/lib/value-store';

// App-wide choices the person makes once (in onboarding or Settings) and
// that the capture pipeline reads outside React. One small store, read
// synchronously after `loadPreferences()` has run at startup.

/** 'gemini': use the person's own key. 'offline': everything stays on the phone. 'unset': not chosen yet. */
export type AiMode = 'gemini' | 'offline' | 'unset';
/**
 * The language the phone starts listening in. Not a setting: it's the one
 * the last voice note was in (see use-speech-capture), starting from the
 * phone's own language.
 */
export type SpeechLang = 'en-US' | 'bn-BD';

export interface Preferences {
  aiMode: AiMode;
  speechLang: SpeechLang;
  /** What Home greets them by. Empty: no name. */
  name: string;
  /**
   * Set when Gemini is turned on: threads made before then (offline) stay
   * out of meaning search, so their text never leaves the phone, unless
   * the person agrees (then it's cleared). See PendingProcessor.
   */
  earlierNotesBefore?: number;
  /** Whether they've been asked about those earlier notes since the switch. */
  earlierNotesAsked?: boolean;
  /**
   * Search by meaning (Settings → How Mnemo thinks). Off by default: it sends every note to
   * Google a second time (an embedding), which used up the free quota for little gain.
   */
  meaningSearch?: boolean;
  /** Place reminders (Settings → Location). Off until turned on: nothing is watched or asked for. */
  places?: boolean;
  /** Vibration feedback on taps and results (Settings → Appearance). On unless turned off. */
  haptics?: boolean;
  /** What a place reminder sounds like (lib/place-sound.ts). */
  placeSound?: PlaceSound;
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

const store = createValueStore<Preferences>(DEFAULTS);

/** What is saved on disk, for background tasks that run before `loadPreferences`. */
export async function readSavedPreferences(): Promise<Partial<Preferences>> {
  const raw = await storage.get(KEY);
  return raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
}

/**
 * Reads saved preferences once at startup. `hasKey` lets installs from
 * before this setting existed keep using AI if they had already added a key.
 */
export async function loadPreferences(hasKey: boolean): Promise<Preferences> {
  let loaded: Preferences;
  try {
    loaded = { ...DEFAULTS, ...(await readSavedPreferences()) };
    loaded.name = cleanName(typeof loaded.name === 'string' ? loaded.name : '');
    if (loaded.aiMode === 'unset' && hasKey) loaded.aiMode = 'gemini';
  } catch {
    loaded = { ...DEFAULTS, aiMode: hasKey ? 'gemini' : 'unset' };
  }
  store.set(loaded);
  return loaded;
}

export const getPreferences = (): Preferences => store.get();

export function setPreferences(update: Partial<Preferences>): void {
  const current = store.get();
  // Turning Gemini on: what was written until now was written offline.
  if (update.aiMode === 'gemini' && current.aiMode !== 'gemini') {
    update = { earlierNotesBefore: Date.now(), earlierNotesAsked: false, ...update };
  }
  const next = { ...current, ...update };
  store.set(next);
  storage.set(KEY, JSON.stringify(next)).catch(() => {
    // Kept in memory for this session; saved again on the next change.
  });
}

export const usePreferences = (): Preferences => store.useValue();
