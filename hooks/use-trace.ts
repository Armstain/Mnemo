import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeTrace, traceSnapshot } from '@/lib/trace';

/** The live trace (lib/trace.ts): events so far and what's in progress. */
export function useTrace() {
  return useSyncExternalStore(subscribeTrace, traceSnapshot, traceSnapshot);
}

/** A clock that ticks while something is in progress, for running timers. */
export function useRunningClock(running: boolean, every = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [running, every]);
  return now;
}
