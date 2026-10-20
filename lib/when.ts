import type { MnemoItem } from '@/types/mnemo';

// Reminder times: the quick choices offered, the next time a repeating one
// comes round, and how a reminder reads. Pure, so it's easy to test.

export type Repeat = NonNullable<MnemoItem['repeat']>;

const DAY_MS = 24 * 60 * 60 * 1000;

function at(day: Date, hour: number, minute = 0): Date {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

/** Same day of the month, clamped: a monthly on the 31st lands on Feb 28/29. */
function addMonths(day: Date, n: number): Date {
  const d = new Date(day);
  const target = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(target, last));
  return d;
}

/** The first time at or after `now` a repeating reminder comes round. */
export function nextOccurrence(due: number, repeat: Repeat | undefined, now = Date.now()): number {
  if (!repeat || due > now) return due;
  let d = new Date(due);
  let steps = 0;
  while (d.getTime() <= now && steps++ < 1000) {
    d = repeat === 'daily' ? addDays(d, 1) : repeat === 'weekly' ? addDays(d, 7) : addMonths(d, 1);
  }
  return d.getTime();
}

export interface QuickTime {
  key: string;
  label: string;
  at: number;
}

/** "Later today", "Tomorrow morning", "This weekend", "Next week": whichever are still ahead. */
export function quickTimes(now = Date.now()): QuickTime[] {
  const today = new Date(now);
  const options: QuickTime[] = [];
  const evening = at(today, 18);
  const laterToday = now + 3 * 60 * 60 * 1000;
  if (evening.getTime() > now + 30 * 60 * 1000) options.push({ key: 'evening', label: 'This evening', at: evening.getTime() });
  else if (new Date(laterToday).getDate() === today.getDate()) options.push({ key: 'later', label: 'In 3 hours', at: laterToday });
  options.push({ key: 'tomorrow', label: 'Tomorrow morning', at: at(addDays(today, 1), 9).getTime() });
  const toSaturday = (6 - today.getDay() + 7) % 7 || 7;
  if (toSaturday > 1 && toSaturday <= 5) options.push({ key: 'weekend', label: 'This weekend', at: at(addDays(today, toSaturday), 10).getTime() });
  const toMonday = (1 - today.getDay() + 7) % 7 || 7;
  options.push({ key: 'nextweek', label: 'Next week', at: at(addDays(today, toMonday), 9).getTime() });
  return options;
}

/** Reminders set before times could be picked were at 23:59:59.999: date only. */
export function hasTime(ts: number): boolean {
  const d = new Date(ts);
  return !(d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59);
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Sat, 10:00 AM", "Oct 30, 9:00 AM". */
export function formatReminder(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = at(new Date(now), 0);
  const days = Math.round((at(d, 0).getTime() - today.getTime()) / DAY_MS);
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : days === -1
          ? 'Yesterday'
          : days > 1 && days < 7
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return hasTime(ts) ? `${day}, ${timeOf(ts)}` : day;
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

// ─── Which thread to pick back up ───────────────────────────────

const HALF_LIFE_MS = 3 * DAY_MS;

/**
 * Home's order for open threads: pinned ones first, then by how much each
 * is asking for attention: touched recently, a reminder due within a day
 * (or missed), an open next step, the focus thread. Paused ones sink.
 */
export function resumeOrder(
  threads: MnemoItem[],
  options: { now?: number; focusId?: string | null } = {},
): MnemoItem[] {
  const now = options.now ?? Date.now();
  const score = (t: MnemoItem) => {
    const last = Math.max(t.updatedAt, t.lastResumedAt ?? 0);
    let s = Math.pow(0.5, Math.max(0, now - last) / HALF_LIFE_MS);
    if (t.dueDate && t.dueDate < now + DAY_MS) s += 0.6;
    if (t.nextStep) s += 0.25;
    if (t.id === options.focusId) s += 0.5;
    if (t.status === 'paused') s -= 0.5;
    return s;
  };
  return [...threads].sort((a, b) => {
    if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
    return score(b) - score(a);
  });
}

/** "You were just here": touched within this long. */
const JUST_HERE_MS = 6 * 60 * 60 * 1000;

/** Why a thread sits at the top of Home, in the order that wins when several apply. */
export type ResumeReason =
  | { kind: 'missed'; at: number }
  | { kind: 'due'; at: number }
  | { kind: 'starred' }
  | { kind: 'focus' }
  | { kind: 'recent' }
  | null;

/**
 * The plain reason `resumeOrder` put this thread first, so Home can say it:
 * a reminder missed or due within a day, pinned, the focus thread, or
 * touched in the last few hours. Null when it's only "least cold".
 */
export function resumeReason(
  thread: MnemoItem,
  options: { now?: number; focusId?: string | null } = {},
): ResumeReason {
  const now = options.now ?? Date.now();
  if (thread.dueDate) {
    const at = nextOccurrence(thread.dueDate, thread.repeat, now);
    if (!thread.repeat && at < now) return { kind: 'missed', at };
    if (at < now + DAY_MS) return { kind: 'due', at };
  }
  if (thread.starred) return { kind: 'starred' };
  if (thread.id === options.focusId) return { kind: 'focus' };
  if (now - Math.max(thread.updatedAt, thread.lastResumedAt ?? 0) < JUST_HERE_MS) return { kind: 'recent' };
  return null;
}
