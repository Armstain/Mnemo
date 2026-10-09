import { formatDistanceToNowStrict } from 'date-fns';

/** Formats elapsed milliseconds as `M:SS`, for a live recording timer. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatCompactDistance(date: Date | string | number): string {
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How "warm" a thread still is, from 1 (touched just now) down to 0 at
 * `horizonDays` — the same 14-day point where nudges stop treating a
 * thread as paused and start treating it as abandoned (lib/nudges.ts).
 */
export function freshness(timestamp: number, horizonDays = 14, now = Date.now()): number {
  const age = Math.max(0, now - timestamp);
  return Math.max(0, 1 - age / (horizonDays * DAY_MS));
}
