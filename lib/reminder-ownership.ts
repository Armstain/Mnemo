import { isArmed } from '@/lib/places';
import { queueSteps } from '@/lib/when';
import type { LaterStep, MnemoItem, PlaceReminder } from '@/types/mnemo';

// Who owns a reminder when notes get connected.
//
// A thread owns its reminders (`dueDate`/`repeat`/`laterSteps`, and one `place`). Connecting
// notes — auto-filing, a suggestion, "Related threads" — is about content, and must never change
// which reminders exist. Only one thing ever hands a reminder to another thread: a thread's last
// note moving out, so the thread itself goes. Then its reminders move with the note when the
// other thread has room, and the move is refused, with a reason, when it would overwrite one.
// See docs/audits/tasks-and-reminders-2026-11.md (P1).

type Reminders = Pick<MnemoItem, 'title' | 'status' | 'place' | 'dueDate' | 'repeat' | 'laterSteps' | 'nextStep'>;

/** The thread's place reminder, while it can still ring. */
export function armedPlace(t: Pick<MnemoItem, 'place' | 'status'>): PlaceReminder | undefined {
  return isArmed(t) ? t.place : undefined;
}

/** Same place, same side, same days: one reminder, set twice. */
export function samePlaceReminder(a: PlaceReminder, b: Pick<PlaceReminder, 'placeId' | 'on' | 'repeat' | 'days'>): boolean {
  return a.placeId === b.placeId && a.on === b.on && a.repeat === b.repeat && String(a.days ?? '') === String(b.days ?? '');
}

/** Setting `next` on this thread would replace a different place reminder that can still ring. */
export function replacesPlaceReminder(t: Pick<MnemoItem, 'place' | 'status'>, next: Pick<PlaceReminder, 'placeId' | 'on' | 'repeat' | 'days'>): boolean {
  const current = armedPlace(t);
  return !!current && !samePlaceReminder(current, next);
}

/** A time reminder that will still go off: a future one, a repeating one, or steps still queued. */
function hasLiveTime(t: Pick<MnemoItem, 'dueDate' | 'repeat' | 'laterSteps'>, now: number): boolean {
  return (!!t.dueDate && (!!t.repeat || t.dueDate > now)) || (t.laterSteps ?? []).some((l) => l.at > now);
}

/**
 * Adds a time reminder to a thread that may have one: it becomes the thread's reminder when the
 * thread has none still ahead (or `force`), otherwise it is queued after it as a later step.
 */
export function withReminders(
  thread: Pick<MnemoItem, 'dueDate' | 'repeat' | 'laterSteps'>,
  add: { due: number; step?: string; later: LaterStep[]; repeat?: MnemoItem['repeat']; force?: boolean },
  now = Date.now(),
): Partial<MnemoItem> {
  // A repeating reminder's stored time is its first one, often past: it is still the thread's reminder.
  if (add.force || !thread.dueDate || (thread.dueDate < now && !thread.repeat)) {
    return { dueDate: add.due, repeat: add.repeat, ...(add.later.length > 0 ? { laterSteps: queueSteps(thread.laterSteps, add.later) } : {}) };
  }
  const queued = [{ at: add.due, step: add.step }, ...add.later].filter((l) => l.at !== thread.dueDate && (!thread.repeat || l.at > now));
  return queued.length > 0 ? { laterSteps: queueSteps(thread.laterSteps, queued) } : {};
}

/**
 * Whether auto-filing (a guess) may move a capture into another thread. Not when the capture owns
 * a place reminder or a repeating reminder: one thread holds one place reminder and one schedule,
 * so filing it would drop or overwrite one. Such a capture keeps its own thread, and the match is
 * only suggested. `heard`: a place reminder read from the words but not yet set (voice notes).
 */
export function mayAutoFile(own: Pick<MnemoItem, 'place' | 'status' | 'dueDate' | 'repeat'> | undefined, heard?: unknown): boolean {
  if (heard) return false;
  if (!own) return true;
  return !armedPlace(own) && !(own.repeat && own.dueDate);
}

export type Fold = { ok: true; carry: Partial<MnemoItem> } | { ok: false; reason: string };

/**
 * `from` is about to lose its last note to `to` and be removed. What `to` takes over so no
 * reminder is lost (`carry`, possibly empty), or why the move can't happen without losing one.
 */
export function foldReminders(from: Reminders, to: Reminders, now = Date.now()): Fold {
  const carry: Partial<MnemoItem> = {};
  const place = armedPlace(from);
  if (place) {
    if (replacesPlaceReminder(to, place)) {
      return { ok: false, reason: `Not moved: "${to.title}" has its own place reminder, and this note's would be lost.` };
    }
    if (!armedPlace(to)) carry.place = place;
  }
  if (from.dueDate || (from.laterSteps?.length ?? 0) > 0) {
    // A schedule can't be queued as a one-off step without losing its repeat.
    if (from.repeat && from.dueDate && hasLiveTime(to, now)) {
      return { ok: false, reason: `Not moved: "${to.title}" has its own reminder, and this note's repeating one would be lost.` };
    }
    const [first, ...rest] = from.dueDate ? [{ at: from.dueDate, step: from.nextStep }, ...(from.laterSteps ?? [])] : (from.laterSteps ?? []);
    Object.assign(carry, withReminders(to, { due: first.at, step: first.step, later: rest, repeat: from.repeat }, now));
  }
  return { ok: true, carry };
}
