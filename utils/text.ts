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

export interface TextSelection {
  start: number;
  end: number;
}

/**
 * Wraps the selected substring in `**`. With text selected the wrapped span
 * stays selected, so tapping Bold again unwraps it; with no selection the
 * cursor lands between the markers so typing starts out bold.
 */
export function toggleBold(value: string, selection: TextSelection) {
  const { start, end } = selection;
  const marker = '**';
  const selected = value.slice(start, end);

  // Already wrapped? Unwrap instead of nesting.
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    const next =
      value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
    return {
      next,
      nextSelection: { start: start - marker.length, end: end - marker.length },
    };
  }

  const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
  const nextSelection =
    selected.length > 0
      ? { start: start + marker.length, end: start + marker.length + selected.length }
      : { start: start + marker.length, end: start + marker.length };
  return { next, nextSelection };
}

/**
 * Sets the heading level on the line the cursor sits in. Switching levels
 * replaces the existing `#` prefix rather than stacking onto it, and tapping
 * the level a line already has removes it (back to body text).
 */
export function toggleHeading(value: string, selection: TextSelection, level: 1 | 2 | 3) {
  const { start, end } = selection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndSearch = value.indexOf('\n', end);
  const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch;

  const line = value.slice(lineStart, lineEnd);
  const existing = /^(#{1,6})\s+/.exec(line);
  const stripped = existing ? line.slice(existing[0].length) : line;

  const targetPrefix = '#'.repeat(level) + ' ';
  const alreadyThisLevel = existing?.[1].length === level;
  const nextLine = alreadyThisLevel ? stripped : targetPrefix + stripped;

  const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd);
  const delta = nextLine.length - line.length;
  return {
    next,
    nextSelection: {
      start: Math.max(lineStart, start + delta),
      end: Math.max(lineStart, end + delta),
    },
  };
}
