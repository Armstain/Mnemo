import { createEmitter } from '@/lib/emitter';
import { storage } from '@/lib/storage';

// The Resume card opening into its thread: Home hands the card's place on
// screen to an overlay (components/CardFlightHost), which grows a copy of
// it into the thread's page while the real screen loads underneath. The
// thread screen reports where its title landed so the copy's title can
// fly to exactly that spot.
//
// It costs one overlay animated on the UI thread, while the thread screen
// mounts. If a phone can't keep up, the flight measures that and switches
// itself off for good; opening a thread then uses the plain entrance.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Flight {
  threadId: string;
  from: Rect;
  titleFrom: Rect;
  title: string;
  /** The reason chip, faded out as the card opens. */
  chip?: string;
}

const flights = createEmitter<Flight>();
export const launchFlight = flights.emit;
export const onFlight = flights.on;

// ─── Where the thread's title is ───────────────────────────────

const targets = createEmitter<{ threadId: string; rect: Rect }>();

/** The thread screen, once its title is laid out. */
export function reportFlightTarget(threadId: string, rect: Rect): void {
  targets.emit({ threadId, rect });
}
export const onFlightTarget = targets.on;

// ─── Is this phone keeping up? ─────────────────────────────────

const SLOW_KEY = 'mnemo.cardFlight.slow';

/** A flight slower than this on average reads as stutter (about 40 fps). */
const SLOW_FRAME_MS = 25;
/** Slow flights in a row before giving up: one can be a busy moment. */
const SLOW_STRIKES = 2;

let slow: boolean | null = null;
let strikes = 0;

/** Loaded once at launch; until then, flights wait for it. */
export async function loadFlightPerformance(): Promise<boolean> {
  if (slow === null) {
    try {
      slow = (await storage.get(SLOW_KEY)) === '1';
    } catch {
      slow = false;
    }
  }
  return slow;
}

/** Whether flights are on: not on a phone that has shown it can't keep up. */
export function flightsEnabled(): boolean {
  return slow === false;
}

/**
 * Whether a flight's frames say the phone is struggling: the average gap
 * between frames after the first (the screen mounting under it is
 * expected to cost that one), over enough frames to mean something.
 */
export function framesLookSlow(totalMs: number, frames: number): boolean {
  if (frames < 4) return false;
  return totalMs / frames > SLOW_FRAME_MS;
}

/** After each flight: two slow ones in a row turn flights off on this phone. */
export function recordFlight(totalMs: number, frames: number): void {
  if (!framesLookSlow(totalMs, frames)) {
    strikes = 0;
    return;
  }
  strikes += 1;
  if (strikes >= SLOW_STRIKES) {
    slow = true;
    storage.set(SLOW_KEY, '1').catch(() => {});
  }
}
