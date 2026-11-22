import AsyncStorage from '@react-native-async-storage/async-storage';

import { isArmed } from '@/lib/places';
import type { MnemoItem, PlaceReminder } from '@/types/mnemo';

// What happened to place reminders, for the problem report (lib/errors.ts): every enter/exit
// Android sent and what Mnemo did with it, each time the places were set, and what opening the
// app caught. Kept so a missed reminder can be told apart afterwards: Android said nothing, or
// Mnemo heard it and didn't ring (and why). Short ids only: no titles, no coordinates.

const KEY = 'mnemo-place-log';
export const PLACE_LOG_MAX = 30;

export interface PlaceLogEntry {
  at: number;
  text: string;
}

/** The last few characters of an id: enough to match a reminder to its events, nothing more. */
export const shortId = (id: string) => id.slice(-4);

/** Local time with its offset, so "10:02" in the report is the time the person remembers. */
export function stamp(at: number | undefined): string {
  if (!at || !Number.isFinite(at)) return 'never';
  const d = new Date(at);
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    ` (${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)})`
  );
}

let queue: Promise<void> = Promise.resolve();

export async function readPlaceLog(): Promise<PlaceLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => e && Number(e.at) && typeof e.text === 'string') : [];
  } catch {
    return [];
  }
}

/** Never throws, never blocks a reminder: logging must not be the next problem. */
export function notePlace(text: string, at = Date.now()): Promise<void> {
  queue = queue.then(async () => {
    try {
      const log = await readPlaceLog();
      await AsyncStorage.setItem(KEY, JSON.stringify([...log, { at, text: text.slice(0, 300) }].slice(-PLACE_LOG_MAX)));
    } catch {
      // Nothing to do.
    }
  });
  return queue;
}

/** "arrive, weekdays" / "leave, once" / "arrive, days 1,3". */
function kind(r: PlaceReminder): string {
  const repeat = !r.repeat ? 'once' : r.repeat === 'days' ? `days ${(r.days ?? []).join(',')}` : r.repeat;
  return `${r.on}, ${repeat}`;
}

function side(r: PlaceReminder): string {
  if (r.insideAtSet === undefined) return 'side unknown';
  return `${r.insideAtSet ? 'inside' : 'outside'} since ${stamp(r.sideAt ?? r.setAt)}`;
}

/** One line per place reminder: what Mnemo believes, which decides whether the next crossing rings. */
export function reminderLines(items: Pick<MnemoItem, 'id' | 'status' | 'place'>[]): string[] {
  const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items
    // Set ones, and one-offs that rang in the last week (to see one that just went off).
    .filter((t) => t.place && (isArmed(t) || (t.place.firedAt ?? 0) > week))
    .map((t) => {
      const r = t.place!;
      const parts = [
        `r:${shortId(t.id)} at p:${shortId(r.placeId)}`,
        kind(r),
        t.status,
        side(r),
        `set ${stamp(r.setAt)}`,
      ];
      if (r.lastFiredAt) parts.push(`last rang ${stamp(r.lastFiredAt)}`);
      if (r.firedAt) parts.push(`rang ${stamp(r.firedAt)} (done)`);
      if (r.doneAt) parts.push(`marked done ${stamp(r.doneAt)}`);
      if (r.caughtLate) parts.push('last one caught late');
      return parts.join(' · ');
    });
}

export function logLines(log: PlaceLogEntry[]): string[] {
  return log.map((e) => `${stamp(e.at)} ${e.text}`);
}
