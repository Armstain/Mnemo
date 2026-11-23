import type { PlaceLogEntry } from '@/lib/place-log';

// The Live debug screen's pure parts (app/debug.tsx): the logs as one timeline, and the hidden
// tap that turns the screen on.

export type DebugSource = 'place' | 'voice' | 'error';

export interface DebugLine {
  at: number;
  source: DebugSource;
  text: string;
}

/** Every log as one timeline, newest first, optionally one source only. */
export function timeline(
  logs: { place: PlaceLogEntry[]; voice: PlaceLogEntry[]; errors: { at: number; where: string; message: string }[] },
  only?: DebugSource,
): DebugLine[] {
  const lines: DebugLine[] = [
    ...logs.place.map((e) => ({ at: e.at, source: 'place' as const, text: e.text })),
    ...logs.voice.map((e) => ({ at: e.at, source: 'voice' as const, text: e.text })),
    ...logs.errors.map((e) => ({ at: e.at, source: 'error' as const, text: `${e.where}: ${e.message}` })),
  ];
  return lines.filter((l) => !only || l.source === only).sort((a, b) => b.at - a.at);
}

/** Taps on the version that turn the debug screen on. */
export const UNLOCK_TAPS = 7;
/** Taps further apart than this start the count again. */
export const UNLOCK_GAP_MS = 1500;

/** Counts quick taps; true on the one that unlocks. */
export function tapCounter(taps = UNLOCK_TAPS, gap = UNLOCK_GAP_MS) {
  let count = 0;
  let last = 0;
  return (now = Date.now()): boolean => {
    count = now - last <= gap ? count + 1 : 1;
    last = now;
    if (count < taps) return false;
    count = 0;
    return true;
  };
}
