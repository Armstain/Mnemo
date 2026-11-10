import { formatDistanceToNowStrict } from 'date-fns';

/** Formats elapsed milliseconds as `M:SS`, for a live recording timer. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** How long ago, in a few characters: "now", "5m", "3h", "2d". */
export function formatCompactDistance(date: Date | string | number, now = Date.now()): string {
  // Seconds are noise in a list; under a minute is just "now".
  if (now - new Date(date).getTime() < 60_000) return 'now';
  const distance = formatDistanceToNowStrict(new Date(date));

  return distance
    .replace(' seconds', 's')
    .replace(' second', 's')
    .replace(' minutes', 'm')
    .replace(' minute', 'm')
    .replace(' hours', 'h')
    .replace(' hour', 'h')
    .replace(' days', 'd')
    .replace(' day', 'd')
    .replace(' months', 'mo')
    .replace(' month', 'mo')
    .replace(' years', 'y')
    .replace(' year', 'y');
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A reminder time that has passed and won't come round again. */
export const isOverdue = (dueDate: number, repeat?: unknown, now = Date.now()) => dueDate < now && !repeat;

/** How long a thread can sit untouched before it counts as abandoned rather than paused. */
export const GIVE_UP_AFTER_MS = 14 * DAY_MS;

/** How "warm" a thread still is, from 1 (touched just now) down to 0 once it counts as abandoned. */
export function freshness(timestamp: number, now = Date.now()): number {
  const age = Math.max(0, now - timestamp);
  return Math.max(0, 1 - age / GIVE_UP_AFTER_MS);
}

/**
 * When an entry was captured, for a thread's timeline: "Today, 14:10",
 * "Yesterday, 09:02", "Oct 3", or "Oct 3, 2025" for another year.
 */
export function formatEntryTime(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return `Today, ${time}`;
  if (timestamp >= startOfToday - DAY_MS) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function startOfDay(ts: number | Date): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

export function atTime(day: Date, hour: number, minute = 0): Date {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
}
