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
