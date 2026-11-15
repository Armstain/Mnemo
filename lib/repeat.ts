import type { Repeat } from '@/types/mnemo';
import { phoneWeekend } from '@/lib/places';

// How a repeating reminder comes round: every day, working day, week, month
// or year; every N days, weeks or months ("every other Wednesday"); or the
// nth weekday of the month ("the last Friday of every month"). The weekday
// of an nth-weekday repeat is the reminder's own. Pure, in the phone's local
// time, so it's easy to test.

export type { Repeat };

type Unit = 'day' | 'week' | 'month' | 'year' | 'weekday';
export type Nth = 1 | 2 | 3 | 4 | -1;

export interface RepeatRule {
  unit: Unit;
  every: number;
  /** For the month: which of its (reminder's weekday)s. -1 is the last. */
  nth?: Nth;
}

const NTH_WORD: Record<string, Nth> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, last: -1 };
const NTH_NAME: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' };

/** The rule a stored repeat stands for; undefined for anything it doesn't know (an old or damaged value). */
export function ruleOf(repeat: string | undefined | null): RepeatRule | undefined {
  switch (repeat) {
    case 'daily':
      return { unit: 'day', every: 1 };
    case 'weekdays':
      return { unit: 'weekday', every: 1 };
    case 'weekly':
      return { unit: 'week', every: 1 };
    case 'monthly':
      return { unit: 'month', every: 1 };
    case 'yearly':
      return { unit: 'year', every: 1 };
  }
  const every = repeat?.match(/^every-(\d{1,3})-(days|weeks|months)$/);
  if (every) {
    const n = Number(every[1]);
    if (n < 1) return undefined;
    return { unit: every[2].slice(0, -1) as Unit, every: n };
  }
  const nth = repeat?.match(/^monthly-(1st|2nd|3rd|4th|last)$/);
  if (nth) return { unit: 'month', every: 1, nth: NTH_WORD[nth[1]] };
  return undefined;
}

export function isRepeat(value: unknown): value is Repeat {
  return typeof value === 'string' && ruleOf(value) !== undefined;
}

/** The stored form of "every N days/weeks/months"; N of 1 is the plain one. */
export function everyN(n: number, unit: 'days' | 'weeks' | 'months'): Repeat {
  if (n <= 1) return unit === 'days' ? 'daily' : unit === 'weeks' ? 'weekly' : 'monthly';
  return `every-${Math.round(n)}-${unit}`;
}

export function nthOfMonth(nth: Nth): Repeat {
  return `monthly-${NTH_NAME[String(nth)]}` as Repeat;
}

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Same day of the month, clamped: the 31st lands on Feb 28/29, and the next month is the 31st again. */
function addMonths(anchor: Date, n: number): Date {
  const d = new Date(anchor);
  const target = anchor.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(target, last));
  return d;
}

/** The nth (or last) `weekday` of the month that `month` is in, at `time`'s hour and minute. */
function nthWeekdayIn(month: Date, nth: Nth, weekday: number, time: Date): Date | undefined {
  const d = new Date(month.getFullYear(), month.getMonth(), 1, time.getHours(), time.getMinutes(), 0, 0);
  if (nth === -1) {
    d.setMonth(d.getMonth() + 1, 0);
    d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
    return d;
  }
  d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (nth - 1) * 7);
  return d.getMonth() === month.getMonth() ? d : undefined;
}

/** Which of its weekday in the month a date is: 1–4, or -1 when it's the last (a 5th is only ever the last). */
export function nthOf(date: Date): { nth: Nth; last: boolean } {
  const n = Math.ceil(date.getDate() / 7);
  const last = addDays(date, 7).getMonth() !== date.getMonth();
  return { nth: n >= 5 ? -1 : (n as Nth), last };
}

const isWorkday = (d: Date, weekend: number[]) => !weekend.includes(d.getDay());

/**
 * Every time the reminder comes round, from `anchor` (its first time) on,
 * in order. An anchor that doesn't fit the rule itself (a Saturday for
 * "weekdays") is skipped.
 */
export function* occurrences(anchor: number, repeat: Repeat, weekend: number[] = phoneWeekend(), fromIndex = 0): Generator<number> {
  const rule = ruleOf(repeat);
  const a = new Date(anchor);
  if (!rule) {
    yield anchor;
    return;
  }
  if (rule.unit === 'weekday') {
    if (weekend.length >= 7) return;
    for (let d = addDays(a, fromIndex); ; d = addDays(d, 1)) if (isWorkday(d, weekend)) yield d.getTime();
  }
  if (rule.nth !== undefined) {
    for (let k = fromIndex; ; k++) {
      const month = addMonths(new Date(a.getFullYear(), a.getMonth(), 1), k);
      const d = nthWeekdayIn(month, rule.nth, a.getDay(), a);
      if (d && d.getTime() >= anchor) yield d.getTime();
    }
  }
  for (let k = fromIndex; ; k++) {
    const n = k * rule.every;
    if (rule.unit === 'day') yield addDays(a, n).getTime();
    else if (rule.unit === 'week') yield addDays(a, n * 7).getTime();
    else if (rule.unit === 'month') yield addMonths(a, n).getTime();
    else yield addMonths(a, n * 12).getTime();
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many steps can safely be skipped to get near `now` (short of it, so DST never overshoots). */
function skipTo(anchor: number, rule: RepeatRule, now: number): number {
  const per = rule.unit === 'day' ? DAY_MS : rule.unit === 'week' ? 7 * DAY_MS : rule.unit === 'weekday' ? DAY_MS : rule.unit === 'month' ? 28 * DAY_MS : 365 * DAY_MS;
  const k = Math.floor((now - anchor) / (per * (rule.nth !== undefined ? 1 : rule.every))) - 2;
  return Math.max(0, k);
}

/** The first time after `now` a repeating reminder comes round; `due` itself while it's still ahead. */
export function nextOccurrence(due: number, repeat: Repeat | undefined, now = Date.now(), weekend: number[] = phoneWeekend()): number {
  const rule = ruleOf(repeat);
  if (!rule) return due;
  if (due > now && (rule.unit !== 'weekday' || isWorkday(new Date(due), weekend))) return due;
  const from = due > now ? 0 : skipTo(due, rule, now);
  let steps = 0;
  for (const at of occurrences(due, repeat!, weekend, rule.unit === 'weekday' ? 0 : from)) {
    if (at > now || steps++ > 5000) return at;
  }
  return due;
}

/** The next few times it comes round after `now`: at most `limit`, and none past `horizon` from now (always at least one). */
export function upcoming(due: number, repeat: Repeat, now = Date.now(), { limit = 12, horizon = 45 * DAY_MS } = {}, weekend: number[] = phoneWeekend()): number[] {
  const first = nextOccurrence(due, repeat, now, weekend);
  const out: number[] = [];
  for (const at of occurrences(first, repeat, weekend)) {
    if (at <= now) continue;
    if (out.length >= limit || (out.length > 0 && at > now + horizon)) break;
    out.push(at);
  }
  return out;
}

/**
 * The first time at or after `at` that fits the rule: the next working day
 * for "weekdays", the next last Friday for "the last Friday of the month".
 * Used when a reminder is read from what was said ("every weekday at 7",
 * said on a Saturday) so its first time is a real one.
 */
export function alignTo(at: number, repeat: Repeat | undefined, weekend: number[] = phoneWeekend()): number {
  const rule = ruleOf(repeat);
  if (!rule) return at;
  let d = new Date(at);
  if (rule.unit === 'weekday') {
    for (let i = 0; i < 7 && !isWorkday(d, weekend); i++) d = addDays(d, 1);
    return d.getTime();
  }
  if (rule.nth !== undefined) return alignNth(at, rule.nth);
  return at;
}

/** The first date at or after `at`, on its weekday, that is the nth (or last) of the month. */
export function alignNth(at: number, nth: Nth): number {
  let d = new Date(at);
  for (let i = 0; i < 10; i++, d = addDays(d, 7)) {
    const of = nthOf(d);
    if (nth === -1 ? of.last : of.nth === nth) return d.getTime();
  }
  return at;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' };

/**
 * "Every day", "Every other week", "Every 3 days", "Every year",
 * "Every month on the last Friday". With `due`, a weekly repeat names its day.
 */
export function repeatLabel(repeat: Repeat, due?: number): string {
  const rule = ruleOf(repeat);
  if (!rule) return 'Repeats';
  const day = due !== undefined ? WEEKDAY_NAMES[new Date(due).getDay()] : undefined;
  if (rule.unit === 'weekday') return 'Every weekday';
  if (rule.nth !== undefined) return day ? `Every month on the ${ORDINAL[String(rule.nth)]} ${day}` : `The ${ORDINAL[String(rule.nth)]} weekday of the month`;
  const unit = rule.unit;
  if (rule.every === 1) {
    if (unit === 'week' && day) return `Every ${day}`;
    return { day: 'Every day', week: 'Every week', month: 'Every month', year: 'Every year' }[unit];
  }
  if (rule.every === 2) {
    if (unit === 'week' && day) return `Every other ${day}`;
    return `Every other ${unit}`;
  }
  return `Every ${rule.every} ${unit}s`;
}

/** The repeats the phone can ring by itself forever; the others are set a few times ahead and topped up (lib/reminders.ts). */
export function nativeRepeat(repeat: Repeat): 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | undefined {
  return repeat === 'daily' || repeat === 'weekly' || repeat === 'monthly' || repeat === 'yearly' || repeat === 'weekdays' ? repeat : undefined;
}
