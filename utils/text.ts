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
