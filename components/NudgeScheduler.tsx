import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { scheduleNudges } from '@/lib/nudges';

// Edits arrive in bursts (typing, AI structuring patching several fields),
// and a replan cancels and reschedules every nudge — wait for it to settle.
const REPLAN_DEBOUNCE_MS = 1500;

/**
 * Invisible component mounted at the app root, next to PendingProcessor.
 * Keeps the scheduled nudges (lib/nudges.ts) in step with the items: it
 * re-plans after any change, and whenever the app returns to the
 * foreground, since a plan only looks a week ahead.
 */
export function NudgeScheduler() {
  const { items, isLoaded } = useMnemoStore();
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!isLoaded) return;
    const handle = setTimeout(() => scheduleNudges(items), REPLAN_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [items, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') scheduleNudges(itemsRef.current);
    });
    return () => subscription.remove();
  }, [isLoaded]);

  return null;
}
