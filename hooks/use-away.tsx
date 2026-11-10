import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { onAppActive, onAppBackground, type AwayState } from '@/lib/away';
import { storage } from '@/lib/storage';
import { createValueStore } from '@/lib/value-store';

const KEY = 'mnemo-away';

// One state for the whole app, so Home remounting doesn't count as a return.
const away = createValueStore<AwayState | null>(null);
let started: Promise<void> | null = null;

function parse(raw: string | null): AwayState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return {};
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return { lastSeenAt: num(v.lastSeenAt), since: num(v.since), returnedAt: num(v.returnedAt), presentedFor: num(v.presentedFor) };
  } catch {
    return {};
  }
}

function commit(next: AwayState) {
  away.set(next);
  storage.set(KEY, JSON.stringify(next)).catch(() => {
    // Not remembered: at worst the card shows again, or not at all, next time.
  });
}

function start(): Promise<void> {
  if (!started) {
    started = storage
      .get(KEY)
      .catch(() => null)
      .then((raw) => {
        commit(onAppActive(parse(raw), Date.now()));
        AppState.addEventListener('change', (s) => {
          const state = away.get();
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
export function useAwaySince(): {
  since: number | null;
  /** The full welcome page has been opened for this return already. */
  presented: boolean;
  markPresented: () => void;
  dismiss: () => void;
} {
  const current = away.useValue();

  useEffect(() => {
    void start();
  }, []);

  const dismiss = useCallback(() => commit({ lastSeenAt: Date.now() }), []);
  const markPresented = useCallback(() => {
    const state = away.get();
    if (state?.since !== undefined) commit({ ...state, presentedFor: state.since });
  }, []);
  const since = current?.since ?? null;
  return { since, presented: since !== null && current?.presentedFor === since, markPresented, dismiss };
}
