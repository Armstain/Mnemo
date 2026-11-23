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

/**
 * A short, local log for the problem report (lib/errors.ts): what happened, kept so a failure
 * can be explained afterwards. Never sent anywhere by itself. One per subject (places, voice).
 */
export function diagnosticLog(key: string, max = PLACE_LOG_MAX) {
  let queue: Promise<void> = Promise.resolve();
  const read = async (): Promise<PlaceLogEntry[]> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((e) => e && Number(e.at) && typeof e.text === 'string') : [];
    } catch {
      return [];
    }
  };
  /** Never throws, never blocks: logging must not be the next problem. */
  const note = (text: string, at = Date.now()): Promise<void> => {
    queue = queue.then(async () => {
      try {
        const log = await read();
        await AsyncStorage.setItem(key, JSON.stringify([...log, { at, text: text.slice(0, 300) }].slice(-max)));
      } catch {
        // Nothing to do.
      }
    });
    return queue;
  };
  const clear = (): Promise<void> => {
    queue = queue.then(() => AsyncStorage.removeItem(key).catch(() => {}));
    return queue;
  };
  return { read, note, clear };
}

const placeLog = diagnosticLog(KEY);
export const readPlaceLog = placeLog.read;
export const notePlace = placeLog.note;
export const clearPlaceLog = placeLog.clear;

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
export function reminderLines(items: (Pick<MnemoItem, 'id' | 'status' | 'place'> & { updatedAt?: number })[]): string[] {
  const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items
    // Set ones, one-offs that rang in the last week (to see one that just went off), and threads
    // with one that were finished or archived this week (to see why a place stopped being watched).
    .filter((t) => t.place && (isArmed(t) || (t.place.firedAt ?? 0) > week || (t.updatedAt ?? 0) > week))
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
