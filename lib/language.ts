import type { SpeechLang } from '@/lib/preferences';

const BENGALI = /[\u0980-\u09FF]/g;
const LATIN = /[A-Za-z]/g;
const DEVANAGARI = /[\u0900-\u097F]/g;

/**
 * Which language a text is mostly in, by script (null if too short to tell). Hindi script counts
 * as Bangla: Mnemo only listens in Bangla and English, so Devanagari is Bangla misheard (as with
 * `heardLanguage`). Counted as English, one misheard note switched listening to English, and from
 * then on Bangla came back as random English offline, and Whisper's Hindi was no longer corrected.
 */
export function languageOf(text: string): SpeechLang | null {
  const bn = (text.match(BENGALI)?.length ?? 0) + (text.match(DEVANAGARI)?.length ?? 0);
  const en = text.match(LATIN)?.length ?? 0;
  if (bn + en < 4) return null;
  return bn >= en ? 'bn-BD' : 'en-US';
}

/**
 * The language Android's detector says it hears, as one Mnemo listens in.
 * It often names Hindi (or Assamese, Odia, Urdu…) for Bangla speech, so any
 * South Asian guess counts as Bangla; anything unknown is no answer.
 */
export function heardLanguage(detected: string | null | undefined): SpeechLang | null {
  const code = detected?.toLowerCase().split(/[-_]/)[0];
  if (code === 'en') return 'en-US';
  if (code && ['bn', 'hi', 'as', 'or', 'ur', 'ne', 'mr', 'pa', 'gu', 'sa'].includes(code)) return 'bn-BD';
  return null;
}

