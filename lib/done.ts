import type { Entry, MnemoItem } from '@/types/mnemo';
import { kindOf } from '@/lib/kind';
import { repeatsAtPlace } from '@/lib/places';
import { DAY_MS } from '@/utils/time';

// Finishing something gets a moment (components/CelebrationHost), but only
// when it was something to do: a note filed away doesn't deserve fanfare,
// and a celebration for every idea would cheapen the real ones.


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

/**
 * What finishing this thread looks like, decided in one place for every screen that finishes one
 * (the thread's Done, Wrap-up): the full moment for a real task, a plain confirm otherwise.
 * Either way one Undo toast follows (hooks/use-complete-thread.ts); never a second animation.
 */
export function completionFeedback(
  thread: Pick<MnemoItem, 'title' | 'createdAt' | 'type' | 'dueDate' | 'checklistItems' | 'pinned' | 'nextStep'>,
  entries: Pick<Entry, 'stepDone' | 'blocks' | 'nextStep'>[],
  now = Date.now(),
): { celebration?: Celebration; toast: string } {
  const toast = `"${thread.title}" is done`;
  if (!isRealTask(thread, entries)) return { toast };
  const detail = doneSummary(thread, entries, now);
  return { celebration: { title: thread.title, ...(detail ? { detail } : {}) }, toast };
}

// ─── What "Done" does on a thread ────────────────────────────────
// One rule for every Done (the thread screen, the step check on Welcome and the weekly review,
// a notification's Done), worked out each time from what the thread is now; nothing new is
// stored (docs/plans/2026-11-root-fixes.md, B2).

/**
 * - `occurrence`: it has a repeating reminder. Done completes today's; the thread and the
 *   reminder stay (finishing them is the ⋯ menu's "Finish thread and its reminders").
 * - `single`: one thing to do. Its step *is* the task, so there is one Done: it ticks the step,
 *   and finishes the thread.
 * - `steps`: a project, or a task that has gained steps. Steps are ticked one by one; Done
 *   finishes the thread.
 */
export type FinishModel = 'occurrence' | 'single' | 'steps';

export function finishModel(
  thread: Pick<MnemoItem, 'kind' | 'pinned' | 'category' | 'nextStep' | 'dueDate' | 'repeat' | 'laterSteps' | 'place' | 'status'>,
  entries: Pick<Entry, 'nextStep' | 'stepDone'>[],
): FinishModel {
  const open = thread.status === 'active' || thread.status === 'paused';
  if (repeatsAtPlace(thread) || (open && !!thread.repeat && !!thread.dueDate)) return 'occurrence';
  if (kindOf(thread, entries.length) === 'project') return 'steps';
  // Steps queued with their own times ("bring the file at 10, send it at 11").
  if ((thread.laterSteps?.length ?? 0) > 0) return 'steps';
  const openSteps = new Set(
    [thread.nextStep, ...entries.filter((e) => !e.stepDone).map((e) => e.nextStep)]
      .filter((s): s is string => !!s?.trim())
      .map((s) => s.trim().toLowerCase()),
  );
  return openSteps.size > 1 ? 'steps' : 'single';
}
