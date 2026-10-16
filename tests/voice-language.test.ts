import { describe, expect, it } from 'vitest';
import { heardLanguage, languageOf, looksLikeHindi } from '@/lib/language';

describe('which language a voice note is in', () => {
  it("takes Android's detector's word, but only for Bangla or English", () => {
    expect(heardLanguage('en-US')).toBe('en-US');
    expect(heardLanguage('en')).toBe('en-US');
    expect(heardLanguage('bn-BD')).toBe('bn-BD');
    expect(heardLanguage('bn_IN')).toBe('bn-BD');
  });

  it('a Hindi (or other South Asian) guess for Bangla speech counts as Bangla', () => {
    for (const code of ['hi-IN', 'as-IN', 'or-IN', 'ur-PK', 'ne-NP']) expect(heardLanguage(code)).toBe('bn-BD');
  });

  it('no guess, or a language it never listens in, changes nothing', () => {
    for (const code of [undefined, null, '', 'und', 'fr-FR', 'zh-CN']) expect(heardLanguage(code)).toBeNull();
  });

  it('a written-out note says which language it was in, by script', () => {
    expect(languageOf('কাল সকালে ডাক্তারের কাছে যেতে হবে')).toBe('bn-BD');
    expect(languageOf('call the plumber tomorrow')).toBe('en-US');
    expect(languageOf('মিটিং at 5')).toBe('bn-BD');
    expect(languageOf('ok')).toBeNull();
  });

  it('Bangla written out as Hindi is caught, so it can be asked for again as Bangla', () => {
    expect(looksLikeHindi('कल सुबह डॉक्टर के पास जाना है')).toBe(true);
    expect(looksLikeHindi('কাল সকালে ডাক্তারের কাছে যেতে হবে')).toBe(false);
    expect(looksLikeHindi('call the plumber tomorrow')).toBe(false);
    expect(looksLikeHindi('মিটিং আছে, ok')).toBe(false);
  });
});
