import { metricKey, summarizeMeasures } from '@/lib/measures';
import { nextOccurrence } from '@/lib/when';
import type { Entry, MnemoItem } from '@/types/mnemo';
import { DAY_MS } from '@/utils/time';

// The weekly review: one look back at the week and ahead at the next,
// worked out on the phone from the notes. What moved, what's due, which
// steps are open, which threads went quiet, and what the numbers added up to.

/** Quiet this long and a thread is worth a decision: keep going, pause, or wrap up. */
export const QUIET_DAYS = 7;
/** Past this it's not "quiet", it's forgotten; the review stops listing it. */
const FORGOTTEN_DAYS = 60;
/** A reminder missed longer ago than this is old news; the thread may just be quiet. */
const MISSED_DAYS = 30;
/** "Still on it" holds off the question for this long. */
export const STILL_ON_IT_DAYS = 30;

export interface WeekTotal {
  metric: string;
  unit?: string;
  total: number;
  count: number;
  threads: number;
}

export interface DueThread {
  item: MnemoItem;
  /** When it's due: the next time round for a repeating reminder. */
  at: number;
  missed: boolean;
}

export interface WeekReview {
  /** Start of the first of the seven calendar days, ending today. */
  from: number;
  to: number;
  /** Notes added each day, oldest day first (seven of them). */
  days: { start: number; notes: number }[];
  /** Notes added this week, and how many threads they went into. */
  notes: number;
  threadsTouched: number;
  /** Next steps ticked off this week. */
  stepsDone: number;
  /** Reminders missed (in the last month) or due in the coming week. Oldest first. */
  due: DueThread[];
  /** Open next steps on active threads that aren't due or quiet. Most recent first. */
  steps: MnemoItem[];
  /** Active threads untouched for a week or more. */
  quiet: { item: MnemoItem; days: number }[];
  /** Amounts that add up, added this week, across all threads. */
  totals: WeekTotal[];
  /** Threads marked done this week. */
  finished: MnemoItem[];
}

const isOpen = (t: MnemoItem) => (t.status === 'active' || t.status === 'paused') && !t.pending;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** When a thread last moved: its own update, a resume, or its newest entry. */
export function lastActivity(t: MnemoItem, entries: Entry[]): number {
  let last = Math.max(t.updatedAt, t.lastResumedAt ?? 0);
  for (const e of entries) if (e.createdAt > last) last = e.createdAt;
  return last;
}

/**
 * How many days an active thread has sat untouched, if that makes it quiet;
 * null if it doesn't. Not quiet: paused (that was the decision), told
 * "still on it", or waiting on a reminder that hasn't come yet.
 */
export function quietDays(t: MnemoItem, entries: Entry[], now = Date.now()): number | null {
  if (t.status !== 'active' || t.pending) return null;
  if (t.quietUntil && t.quietUntil > now) return null;
  if (t.dueDate && nextOccurrence(t.dueDate, t.repeat, now) > now) return null;
  const days = Math.floor((now - lastActivity(t, entries)) / DAY_MS);
  return days >= QUIET_DAYS ? days : null;
}

export function weekReview(items: MnemoItem[], entries: Entry[], now = Date.now()): WeekReview {
  const from = addDays(startOfDay(now), -6);
  const inWeek = (ts: number) => ts >= from && ts <= now;
  const byThread = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byThread.get(e.threadId);
    if (list) list.push(e);
    else byThread.set(e.threadId, [e]);
  }
  const of = (t: MnemoItem) => byThread.get(t.id) ?? [];

  const thisWeek = entries.filter((e) => inWeek(e.createdAt));
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = addDays(from, i);
    const end = addDays(from, i + 1);
    return { start, notes: thisWeek.filter((e) => e.createdAt >= start && e.createdAt < end).length };
  });
  const open = items.filter(isOpen);

  const due: DueThread[] = [];
  for (const item of open) {
    if (!item.dueDate) continue;
    const at = nextOccurrence(item.dueDate, item.repeat, now);
    const missed = at < now;
    if (missed ? at >= now - MISSED_DAYS * DAY_MS : at <= now + 7 * DAY_MS) due.push({ item, at, missed });
  }
  due.sort((a, b) => a.at - b.at);
  const dueIds = new Set(due.map((d) => d.item.id));

  const quiet = open
    .filter((t) => !dueIds.has(t.id))
    .flatMap((item) => {
      const d = quietDays(item, of(item), now);
      return d !== null && d <= FORGOTTEN_DAYS ? [{ item, days: d }] : [];
    })
    .sort((a, b) => a.days - b.days);
  const quietIds = new Set(quiet.map((q) => q.item.id));

  // Each thread shows up once: a due or quiet thread already says its next step.
  const steps = open
    .filter((t) => t.status === 'active' && t.nextStep && !dueIds.has(t.id) && !quietIds.has(t.id))
    .sort((a, b) => lastActivity(b, of(b)) - lastActivity(a, of(a)));

  // Each thread's sum-type numbers from this week, then added across threads
  // by name and unit (nothing converted).
  const totals = new Map<string, WeekTotal & { ids: Set<string> }>();
  for (const [threadId, list] of byThread) {
    const week = list.filter((e) => inWeek(e.createdAt));
    if (week.length === 0) continue;
    for (const s of summarizeMeasures(week)) {
      if (s.rollup !== 'sum' || !s.total) continue;
      const key = `${metricKey(s.metric)}|${s.unit ?? ''}`;
      const t = totals.get(key) ?? { metric: s.metric, unit: s.unit, total: 0, count: 0, threads: 0, ids: new Set<string>() };
      t.total += s.total;
      t.count += s.points.length;
      t.ids.add(threadId);
      t.threads = t.ids.size;
      totals.set(key, t);
    }
  }

  return {
    from,
    to: now,
    days,
    notes: thisWeek.length,
    threadsTouched: new Set(thisWeek.map((e) => e.threadId)).size,
    stepsDone: entries.filter((e) => e.stepDone && e.nextStep && inWeek(e.updatedAt)).length,
    due,
    steps,
    quiet,
    totals: [...totals.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(({ ids: _ids, ...t }) => ({ ...t, total: Math.round(t.total * 100) / 100 })),
    finished: items
      .filter((t) => t.status === 'completed' && inWeek(t.completedAt ?? t.updatedAt))
      .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
  };
}

/** Next steps still open across what the review lists. */
export function openStepCount(r: WeekReview): number {
  return [...r.due.map((d) => d.item), ...r.steps, ...r.quiet.map((q) => q.item)].filter((t) => t.nextStep).length;
}

/** Home's short version: "5 notes · 2 steps open · 1 quiet". Empty if there's nothing. */
export function shortLine(r: WeekReview): string {
  const open = openStepCount(r);
  return [
    r.notes > 0 ? `${r.notes} ${r.notes === 1 ? 'note' : 'notes'}` : '',
    open > 0 ? `${open} ${open === 1 ? 'step' : 'steps'} open` : '',
    r.quiet.length > 0 ? `${r.quiet.length} quiet` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The one line a weekly notification says, from what the week holds. */
export function reviewLine(r: WeekReview, formatTotal: (t: WeekTotal) => string): string {
  const parts: string[] = [];
  if (r.notes > 0) parts.push(`${r.notes} ${r.notes === 1 ? 'note' : 'notes'} in ${r.threadsTouched} ${r.threadsTouched === 1 ? 'thread' : 'threads'}`);
  if (r.totals[0]) parts.push(formatTotal(r.totals[0]));
  const open = openStepCount(r);
  if (open > 0) parts.push(`${open} ${open === 1 ? 'step' : 'steps'} open`);
  if (r.quiet.length > 0) parts.push(`${r.quiet.length} gone quiet`);
  return parts.length > 0 ? `${parts.join(', ')}.` : 'A quiet week. Anything to pick back up?';
}
