import type { Entry, ThreadOverview } from '@/types/mnemo';
import { entryText } from '@/lib/threads';
import { DAY_MS } from '@/utils/time';

// "Organise these notes": a thread's loose notes grouped by theme, made only
// when the person asks, and only once there's enough to be worth it. The
// AI call itself is in lib/gemini (organiseNotes); this is the logic around it.

/** Fewer notes than this read fine as they are: no offer to organise them. */
export const ORGANISE_MIN_NOTES = 4;
/** The newest notes sent to be organised. */
const MAX_NOTES = 40;
/** A long note is cut here: the gist is what's grouped. */
const MAX_NOTE_CHARS = 600;
const MAX_THEMES = 8;
const MAX_POINTS = 6;
const MAX_OPEN = 5;

export function canOrganise(entries: Pick<Entry, 'id'>[], overview?: ThreadOverview): boolean {
  return !overview && entries.length >= ORGANISE_MIN_NOTES;
}

export function notesSince(overview: ThreadOverview, entries: Pick<Entry, 'createdAt'>[]): number {
  return entries.filter((e) => e.createdAt > overview.at).length;
}

export function notesToOrganise(entries: Pick<Entry, 'blocks' | 'transcript' | 'createdAt'>[]): { text: string; at: number }[] {
  return [...entries]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => ({ text: (entryText(e).trim() || e.transcript?.trim() || '').slice(0, MAX_NOTE_CHARS), at: e.createdAt }))
    .filter((n) => n.text)
    .slice(-MAX_NOTES);
}

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value.flatMap((v) => (typeof v === 'string' && v.trim() ? [v.trim()] : [])).slice(0, max)
    : [];

/** The AI's answer, checked and trimmed to what the card can show; null if it has no themes. */
export function cleanOverview(raw: unknown, notes: number, at: number): ThreadOverview | null {
  const data = (raw ?? {}) as { themes?: unknown; open?: unknown };
  const themes = (Array.isArray(data.themes) ? data.themes : [])
    .flatMap((t) => {
      const theme = (t ?? {}) as { title?: unknown; points?: unknown; notes?: unknown };
      const title = typeof theme.title === 'string' ? theme.title.trim() : '';
      const points = strings(theme.points, MAX_POINTS);
      if (!title || points.length === 0) return [];
      const count = typeof theme.notes === 'number' && theme.notes > 0 ? Math.min(Math.round(theme.notes), notes) : 1;
      return [{ title, points, notes: count }];
    })
    .slice(0, MAX_THEMES);
  if (themes.length === 0) return null;
  return { at, notes, themes, open: strings(data.open, MAX_OPEN) };
}

export function overviewText(title: string, overview: ThreadOverview): string {
  const sections = overview.themes.map((t) => [t.title, ...t.points.map((p) => `• ${p}`)].join('\n'));
  if (overview.open.length > 0) sections.push(['Still open', ...overview.open.map((q) => `• ${q}`)].join('\n'));
  return [title, ...sections].join('\n\n');
}

/** Whole days between the first and last note. */
export function spanDays(entries: { createdAt: number }[]): number {
  if (entries.length === 0) return 0;
  const times = entries.map((e) => e.createdAt);
  return Math.round((Math.max(...times) - Math.min(...times)) / DAY_MS);
}
