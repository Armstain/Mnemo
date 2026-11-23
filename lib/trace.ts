// A live trace of what Mnemo is doing behind the scenes, for the Live debug screen and its
// floating overlay (app/debug.tsx, components/DebugOverlay.tsx): a note saved, queued, sent to
// Gemini (which model, how long), what came back, where it was filed, what the microphone and
// the recognizer are doing. In memory only: never saved, never in the problem report, gone when
// the app closes. It may hold a few words of a note, for the person watching their own phone.

export type TraceLevel = 'info' | 'ok' | 'warn' | 'error';

export interface TraceEvent {
  id: number;
  at: number;
  /** What it's about: a note ("e:ab12"), "voice", "gemini", "places"… */
  topic: string;
  text: string;
  level: TraceLevel;
  /** How long the step took, when it was one (a span). */
  ms?: number;
}

/** Something in progress right now, shown with a running clock. */
export interface TraceSpan {
  id: number;
  since: number;
  topic: string;
  text: string;
}

const MAX = 300;
let nextId = 1;
let events: TraceEvent[] = [];
const active = new Map<number, TraceSpan>();
const listeners = new Set<() => void>();
let snapshot: { events: TraceEvent[]; active: TraceSpan[] } = { events, active: [] };

function changed(): void {
  snapshot = { events, active: [...active.values()] };
  listeners.forEach((l) => l());
}

export function trace(topic: string, text: string, level: TraceLevel = 'info', ms?: number): void {
  events = [...events, { id: nextId++, at: Date.now(), topic, text: text.slice(0, 240), level, ms }].slice(-MAX);
  changed();
}

/**
 * Starts something that takes a while ("Gemini gemini-2.5-flash, audio 120 KB"): shown as in
 * progress until ended, then logged with how long it took. Ending twice does nothing.
 */
export function begin(topic: string, text: string): (level: TraceLevel, result?: string) => void {
  const id = nextId++;
  const since = Date.now();
  active.set(id, { id, since, topic, text });
  changed();
  return (level, result) => {
    if (!active.delete(id)) return;
    trace(topic, result ? `${text} → ${result}` : text, level, Date.now() - since);
  };
}

export function subscribeTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For useSyncExternalStore: the same object until something changes. */
export function traceSnapshot(): { events: TraceEvent[]; active: TraceSpan[] } {
  return snapshot;
}

export function clearTrace(): void {
  events = [];
  changed();
}

/** A note as the trace names it. */
export const noteTopic = (entryId: string) => `e:${entryId.slice(-4)}`;

/** The first words of something, for a trace line. */
export function gist(text: string | undefined, max = 60): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `“${t.slice(0, max - 1)}…”` : `“${t}”`;
}

/** "850 ms" / "3.4 s". */
export function took(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
