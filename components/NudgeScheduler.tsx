import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { scheduleNudges } from '@/lib/nudges';
import { rearmReminders } from '@/lib/reminders';
import { scheduleWeeklyReview } from '@/lib/review-notice';

// Edits arrive in bursts (typing, AI structuring patching several fields),
// and a replan cancels and reschedules every nudge — wait for it to settle.
const REPLAN_DEBOUNCE_MS = 1500;
// Re-setting every reminder on each app switch would be wasteful; this often is plenty.
const REARM_EVERY_MS = 5 * 60 * 1000;

/**
 * Invisible component mounted at the app root, next to PendingProcessor.
 * Keeps the scheduled nudges (lib/nudges.ts) in step with the items: it
 * re-plans after any change, and whenever the app returns to the
 * foreground, since a plan only looks a week ahead. On launch and coming
 * back, it also sets every reminder again, in case the phone dropped them
 * (lib/reminders.ts, rearmReminders).
 */
export function NudgeScheduler() {
  const { items, entries, isLoaded } = useMnemoStore();
  const latest = useRef({ items, entries });
  latest.current = { items, entries };
  const rearmedAt = useRef(0);
  const rearm = () => {
    if (Date.now() - rearmedAt.current < REARM_EVERY_MS) return;
    rearmedAt.current = Date.now();
    rearmReminders(latest.current.items);
  };

  useEffect(() => {
    if (isLoaded) rearm();
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const handle = setTimeout(() => {
      scheduleNudges(items);
      scheduleWeeklyReview(items, entries);
    }, REPLAN_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [items, entries, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      rearm();
      scheduleNudges(latest.current.items);
      scheduleWeeklyReview(latest.current.items, latest.current.entries);
    });
    return () => subscription.remove();
  }, [isLoaded]);

  return null;
}
