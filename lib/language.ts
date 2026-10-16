import type { SpeechLang } from '@/lib/preferences';

const BENGALI = /[\u0980-\u09FF]/g;
const LATIN = /[A-Za-z]/g;

/** Which language a text is mostly in, by script (null if too short to tell). */
export function languageOf(text: string): SpeechLang | null {
  const bn = text.match(BENGALI)?.length ?? 0;
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
