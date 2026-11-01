import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { onAppActive, onAppBackground, type AwayState } from '@/lib/away';

const KEY = 'mnemo-away';

// One state for the whole app, so Home remounting doesn't count as a return.
let state: AwayState | null = null;
let started: Promise<void> | null = null;
const listeners = new Set<(s: AwayState) => void>();

function parse(raw: string | null): AwayState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return {};
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return { lastSeenAt: num(v.lastSeenAt), since: num(v.since), returnedAt: num(v.returnedAt) };
  } catch {
    return {};
  }
}

function commit(next: AwayState) {
  state = next;
  listeners.forEach((l) => l(next));
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {
    // Not remembered: at worst the card shows again, or not at all, next time.
  });
}

function start(): Promise<void> {
  if (!started) {
    started = AsyncStorage.getItem(KEY)
      .catch(() => null)
      .then((raw) => {
        commit(onAppActive(parse(raw), Date.now()));
        AppState.addEventListener('change', (s) => {
          if (!state) return;
          if (s === 'active') commit(onAppActive(state, Date.now()));
          else if (s === 'background') commit(onAppBackground(state, Date.now()));
        });
      });
  }
  return started;
}

/**
 * When the person left, if they've been away long enough for Home to say
 * "welcome back" (lib/away.ts); null otherwise. `dismiss` puts it away
 * until the next time they're gone a while.
 */
export function useAwaySince(): { since: number | null; dismiss: () => void } {
  const [current, setCurrent] = useState<AwayState | null>(state);

  useEffect(() => {
    listeners.add(setCurrent);
    start().then(() => setCurrent(state));
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  const dismiss = useCallback(() => commit({ lastSeenAt: Date.now() }), []);
  return { since: current?.since ?? null, dismiss };
}
