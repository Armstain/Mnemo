import type { Entry, MnemoItem } from '@/types/mnemo';

// Finishing something gets a moment (components/CelebrationHost), but only
// when it was something to do: a note filed away doesn't deserve fanfare,
// and a celebration for every idea would cheapen the real ones.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a thread was a task the person meant to get done: they set a
 * reminder, kept a checklist, wrote its next step themselves, or ticked
 * a step off along the way. An AI-suggested next step alone doesn't count:
 * nearly every note gets one.
 */
export function isRealTask(
  thread: Pick<MnemoItem, 'type' | 'dueDate' | 'checklistItems' | 'pinned' | 'nextStep'>,
  entries: Pick<Entry, 'stepDone' | 'blocks'>[],
): boolean {
  if (thread.dueDate) return true;
  if (thread.type === 'checklist' || (thread.checklistItems?.length ?? 0) > 0) return true;
  if (thread.pinned?.nextStep && thread.nextStep) return true;
  return entries.some((e) => e.stepDone || e.blocks.some((b) => b.kind === 'checklist'));
}

/** The line under "Done": how many steps it took, and how long. '' when there's nothing to say. */
export function doneSummary(
  thread: Pick<MnemoItem, 'createdAt'>,
  entries: Pick<Entry, 'stepDone' | 'nextStep'>[],
  now = Date.now(),
): string {
  const steps = entries.filter((e) => e.stepDone && e.nextStep).length;
  const days = Math.floor((now - thread.createdAt) / DAY_MS);
  return [
    steps > 0 ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : '',
    days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ─── The moment itself ───────────────────────────────────────────
// Screens announce a finished task; the host at the app root plays it, so it
// survives the navigation that usually follows (back to Home, say).

export interface Celebration {
  title: string;
  /** "3 steps · 12 days" */
  detail?: string;
}

const listeners = new Set<(c: Celebration) => void>();

export function celebrate(c: Celebration): void {
  listeners.forEach((l) => l(c));
}

export function onCelebrate(listener: (c: Celebration) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
