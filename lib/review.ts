import { metricKey, summarizeMeasures } from '@/lib/measures';
import type { Entry, MnemoItem } from '@/types/mnemo';

// The weekly review: one look back at the week and ahead at the next,
// worked out on the phone from the notes. What moved, what's due, which
// steps are open, which threads went quiet, and what the numbers added up to.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Quiet this long and a thread is worth a decision: keep going, pause, or wrap up. */
export const QUIET_DAYS = 7;
/** Past this it's not "quiet", it's forgotten; the review stops listing it. */
const FORGOTTEN_DAYS = 60;

export interface WeekTotal {
  metric: string;
  unit?: string;
  total: number;
  count: number;
  threads: number;
}

export interface WeekReview {
  from: number;
  to: number;
  /** Notes added this week, and how many threads they went into. */
  notes: number;
  threadsTouched: number;
  /** Reminders due in the coming week, or already missed. Soonest first. */
  due: MnemoItem[];
  /** Open next steps on threads with no reminder. Most recent first. */
  steps: MnemoItem[];
  /** Open threads untouched for a week or more. */
  quiet: { item: MnemoItem; days: number }[];
  /** Amounts that add up, added this week, across all threads. */
  totals: WeekTotal[];
  /** Threads marked done this week. */
  finished: MnemoItem[];
}

const isOpen = (t: MnemoItem) => (t.status === 'active' || t.status === 'paused') && !t.pending;

/** When a thread last moved: its own update, a resume, or its newest entry. */
export function lastActivity(t: MnemoItem, entries: Entry[]): number {
  let last = Math.max(t.updatedAt, t.lastResumedAt ?? 0);
  for (const e of entries) if (e.createdAt > last) last = e.createdAt;
  return last;
}

export function weekReview(items: MnemoItem[], entries: Entry[], now = Date.now()): WeekReview {
  const from = now - WEEK_MS;
  const byThread = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byThread.get(e.threadId);
    if (list) list.push(e);
    else byThread.set(e.threadId, [e]);
  }

  const thisWeek = entries.filter((e) => e.createdAt >= from && e.createdAt <= now);
  const open = items.filter(isOpen);

  const due = open
    .filter((t) => t.dueDate && t.dueDate <= now + WEEK_MS)
    .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
  const dueIds = new Set(due.map((t) => t.id));

  // A thread with a reminder coming up isn't quiet, it's waiting.
  const quiet = open
    .filter((t) => t.status === 'active' && !dueIds.has(t.id))
    .map((item) => ({ item, days: Math.floor((now - lastActivity(item, byThread.get(item.id) ?? [])) / DAY_MS) }))
    .filter(({ days }) => days >= QUIET_DAYS && days <= FORGOTTEN_DAYS)
    .sort((a, b) => a.days - b.days);
  const quietIds = new Set(quiet.map((q) => q.item.id));

  // Each thread shows up once: a due or quiet thread already says its next step.
  const steps = open
    .filter((t) => t.status === 'active' && t.nextStep && !dueIds.has(t.id) && !quietIds.has(t.id))
    .sort((a, b) => lastActivity(b, byThread.get(b.id) ?? []) - lastActivity(a, byThread.get(a.id) ?? []));

  // Each thread's sum-type numbers from this week, then added across threads
  // by name and unit (nothing converted).
  const totals = new Map<string, WeekTotal & { ids: Set<string> }>();
  for (const [threadId, list] of byThread) {
    const week = list.filter((e) => e.createdAt >= from && e.createdAt <= now);
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
    notes: thisWeek.length,
    threadsTouched: new Set(thisWeek.map((e) => e.threadId)).size,
    due,
    steps,
    quiet,
    totals: [...totals.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(({ ids: _ids, ...t }) => ({ ...t, total: Math.round(t.total * 100) / 100 })),
    finished: items.filter((t) => t.status === 'completed' && t.updatedAt >= from && t.updatedAt <= now),
  };
}

/** The one line a weekly notification says, from what the week holds. */
export function reviewLine(r: WeekReview, formatTotal: (t: WeekTotal) => string): string {
  const parts: string[] = [];
  if (r.notes > 0) parts.push(`${r.notes} ${r.notes === 1 ? 'note' : 'notes'} in ${r.threadsTouched} ${r.threadsTouched === 1 ? 'thread' : 'threads'}`);
  if (r.totals[0]) parts.push(formatTotal(r.totals[0]));
  const open = [...r.due, ...r.steps, ...r.quiet.map((q) => q.item)].filter((t) => t.nextStep).length;
  if (open > 0) parts.push(`${open} ${open === 1 ? 'step' : 'steps'} open`);
  if (r.quiet.length > 0) parts.push(`${r.quiet.length} gone quiet`);
  return parts.length > 0 ? `${parts.join(', ')}.` : 'A quiet week. Anything to pick back up?';
}
