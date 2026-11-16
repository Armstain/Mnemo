import { nfc } from '@/utils/text';

export const SEARCH_TERMS_RULE =
  '5-10 lowercase words or short phrases the person might type later to find this note that the note itself does not contain: synonyms and broader words for its topic, and its key words in the other language or script they use (the English word for a Bangla one, the Bangla-script spelling of a Banglish word, and the reverse). Hidden from the person and used only for search, so this is the one field where translating is right. It never changes how any other field is written. Empty array if nothing useful to add.';

const MAX_TERMS = 12;
const MAX_TERM_CHARS = 40;

export function cleanSearchTerms(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const terms = raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => nfc(t).toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2 && t.length <= MAX_TERM_CHARS);
  const unique = [...new Set(terms)].slice(0, MAX_TERMS);
  return unique.length > 0 ? unique : undefined;
}
