// Small text helpers shared by the note reader, numbers and the timeline.

/** Unicode NFC, so Bangla typed or spoken different ways compares equal. */
export function nfc(text: string): string {
  try {
    return text.normalize('NFC');
  } catch {
    return text;
  }
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "https://www.example.com/a" → "example.com" (or the text itself if it isn't a link). */
export function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
  return m ? m[1] : url;
}

// A letter (with its marks, for Bangla vowel signs) or a digit.
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';
const GAP = new RegExp(`(?:(?!${WORD_CHAR}).)+`, 'gsu');

/** Just the words, lowercased, for "do these say the same thing?" */
function bareWords(text: string): string[] {
  return nfc(text).toLowerCase().replace(GAP, ' ').trim().split(' ').filter(Boolean);
}

/** Whether two lines say the same words, ignoring case and punctuation. */
export function sameWords(a: string, b: string): boolean {
  return bareWords(a).join(' ') === bareWords(b).join(' ');
}

/**
 * `text` without a leading repeat of `lead`, so a preview under a title
 * doesn't say the title again: "Book idea: a short story…" under "Book
 * idea" → "A short story…". Whole words only; the text itself otherwise.
 */
export function withoutLead(text: string, lead: string): string {
  const words = bareWords(lead);
  if (words.length === 0) return text;
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const gap = `(?:(?!${WORD_CHAR}).)`;
  const pattern = new RegExp(`^${gap}*${words.map(escape).join(`${gap}+`)}(?!${WORD_CHAR})${gap}*`, 'iu');
  const source = nfc(text);
  const match = source.match(pattern);
  return match ? capitalize(source.slice(match[0].length)) : text;
}
