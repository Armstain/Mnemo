import { describe, expect, it, vi } from 'vitest';

import { alignTo, isRepeat, nextOccurrence, occurrences, repeatLabel, ruleOf, upcoming } from '@/lib/repeat';
import { readWhenFull, withoutWhen } from '@/lib/when-read';
import { recurrenceFor } from '@/lib/calendar';

// Hoisted by vitest above the imports.
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
vi.mock('@/lib/errors', () => ({ logError: () => {} }));

const d = (s: string) => new Date(s).getTime();
const SAT_SUN = [6, 0];
const FRI_SAT = [5, 6];
const day = (ts: number) => new Date(ts).toDateString();

describe('what a stored repeat means', () => {
  it('knows the old ones and the new ones, and nothing else', () => {
    for (const r of ['daily', 'weekly', 'monthly', 'weekdays', 'yearly', 'every-2-weeks', 'every-3-days', 'every-6-months', 'monthly-1st', 'monthly-last']) {
      expect(isRepeat(r)).toBe(true);
    }
    for (const r of ['hourly', 'every-0-days', 'every-2-years', 'monthly-5th', '', null, 3]) expect(isRepeat(r)).toBe(false);
    expect(ruleOf('every-2-weeks')).toEqual({ unit: 'week', every: 2 });
    expect(ruleOf('monthly-last')).toEqual({ unit: 'month', every: 1, nth: -1 });
  });

  it('reads as people say it', () => {
    const wed = d('2026-11-18T18:00:00');
    expect(repeatLabel('every-2-weeks', wed)).toBe('Every other Wednesday');
    expect(repeatLabel('weekly', wed)).toBe('Every Wednesday');
    expect(repeatLabel('every-3-days')).toBe('Every 3 days');
    expect(repeatLabel('monthly-last', d('2026-11-27T17:00:00'))).toBe('Every month on the last Friday');
    expect(repeatLabel('weekdays')).toBe('Every weekday');
    expect(repeatLabel('yearly')).toBe('Every year');
  });
});

describe('when it comes round', () => {
  it('every other week skips a week', () => {
    const first = d('2026-11-18T18:00:00');
    expect(nextOccurrence(first, 'every-2-weeks', d('2026-11-19T09:00:00'))).toBe(d('2026-12-02T18:00:00'));
    expect(nextOccurrence(first, 'every-2-weeks', d('2027-03-01T09:00:00'))).toBe(d('2027-03-10T18:00:00'));
  });

  it('weekdays skip the weekend, whichever days the weekend is', () => {
    const fri = d('2026-11-20T07:00:00');
    expect(day(nextOccurrence(fri, 'weekdays', d('2026-11-20T08:00:00'), SAT_SUN))).toBe(day(d('2026-11-23T07:00:00')));
    // Bangladesh: Friday and Saturday off, so Thursday is followed by Sunday.
    const thu = d('2026-11-19T07:00:00');
    expect(day(nextOccurrence(thu, 'weekdays', d('2026-11-19T08:00:00'), FRI_SAT))).toBe(day(d('2026-11-22T07:00:00')));
  });

  it('the last Friday of every month', () => {
    const first = d('2026-11-27T17:00:00');
    const next = upcoming(first, 'monthly-last', d('2026-11-28T00:00:00'), { limit: 3, horizon: 400 * 864e5 });
    expect(next.map(day)).toEqual([d('2026-12-25T17:00:00'), d('2027-01-29T17:00:00'), d('2027-02-26T17:00:00')].map(day));
  });

  it('the first Monday of every month', () => {
    const first = d('2026-12-07T10:00:00');
    expect(day(nextOccurrence(first, 'monthly-1st', d('2026-12-08T00:00:00')))).toBe(day(d('2027-01-04T10:00:00')));
  });

  it('a month on the 31st stays on the 31st when it can', () => {
    const first = d('2027-01-31T09:00:00');
    const next: string[] = [];
    for (const at of occurrences(first, 'monthly')) if (next.push(day(at)) >= 4) break;
    expect(next).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'].map((s) => day(d(`${s}T09:00:00`))));
  });

  it('yearly, and every 3 days, far into the future', () => {
    expect(nextOccurrence(d('2026-12-03T09:00:00'), 'yearly', d('2030-06-01T00:00:00'))).toBe(d('2030-12-03T09:00:00'));
    expect(nextOccurrence(d('2026-11-15T08:00:00'), 'every-3-days', d('2026-11-21T09:00:00'))).toBe(d('2026-11-24T08:00:00'));
  });

  it('a few times ahead, within the horizon, always at least one', () => {
    const now = d('2026-11-15T00:00:00');
    expect(upcoming(d('2026-11-15T08:00:00'), 'every-3-days', now)).toHaveLength(12);
    expect(upcoming(d('2026-12-03T09:00:00'), 'yearly', now)).toEqual([d('2026-12-03T09:00:00')]);
    expect(upcoming(d('2026-11-27T17:00:00'), 'monthly-last', now)).toHaveLength(2);
  });

  it('a first time that does not fit moves to one that does', () => {
    expect(day(alignTo(d('2026-11-14T07:00:00'), 'weekdays', SAT_SUN))).toBe(day(d('2026-11-16T07:00:00')));
    expect(alignTo(d('2026-11-14T07:00:00'), 'daily', SAT_SUN)).toBe(d('2026-11-14T07:00:00'));
  });
});

describe('heard in a note', () => {
  const now = d('2026-11-14T10:00:00'); // a Saturday
  const read = (s: string) => {
    const w = readWhenFull(s, now);
    return w && { at: new Date(w.at).toString().slice(0, 21), repeat: w.repeat };
  };

  it.each([
    ['every other wednesday choir at 6pm', 'Wed Nov 18 2026 18:00', 'every-2-weeks'],
    ['fortnightly review on friday at 3pm', 'Fri Nov 20 2026 15:00', 'every-2-weeks'],
    ['every 3 days water the plants at 8am', 'Sun Nov 15 2026 08:00', 'every-3-days'],
    ['every two weeks clean the fridge at 9am', 'Sat Nov 21 2026 09:00', 'every-2-weeks'],
    ['every year on december 3 grandma birthday', 'Thu Dec 03 2026 09:00', 'yearly'],
    ['pay rent on the last friday of every month at 5pm', 'Fri Nov 27 2026 17:00', 'monthly-last'],
    ['team sync every first monday of the month at 10', 'Mon Dec 07 2026 10:00', 'monthly-1st'],
    ['প্রতি বছর ডিসেম্বর ৩ তারিখে দাদুর জন্মদিন', 'Thu Dec 03 2026 09:00', 'yearly'],
  ])('%s', (said, at, repeat) => {
    expect(read(said)).toEqual({ at, repeat });
  });

  it('every weekday, said at the weekend, starts on the next working day', () => {
    const w = readWhenFull('every weekday at 7 walk the dog', now)!;
    expect(w.repeat).toBe('weekdays');
    expect([1, 2, 3, 4, 0]).toContain(new Date(w.at).getDay());
    expect(new Date(w.at).getHours()).toBe(7);
  });

  it('the last Thursday of the month, once', () => {
    expect(read('book club the last thursday of the month at 7pm')).toEqual({ at: 'Thu Nov 26 2026 19:00', repeat: undefined });
  });

  it('the old ones read as before', () => {
    expect(read('call mom every day at 8pm')?.repeat).toBe('daily');
    expect(read('take out trash every monday')?.repeat).toBe('weekly');
    expect(read('pay the internet bill every month on the 5th')?.repeat).toBe('monthly');
  });

  it('what is left is the thing to do', () => {
    expect(withoutWhen('every other wednesday choir at 6pm')).toBe('choir');
    expect(withoutWhen('pay rent on the last friday of every month at 5pm')).toBe('pay rent');
    expect(withoutWhen('submit report on weekdays at 9am')).toBe('submit report');
    expect(withoutWhen('every 3 days water the plants')).toBe('water the plants');
  });
});

describe('in the phone calendar', () => {
  it('repeats the event the same way', () => {
    const wed = d('2026-11-18T18:00:00');
    expect(recurrenceFor('every-2-weeks', wed)).toEqual({ frequency: 'weekly', interval: 2 });
    expect(recurrenceFor('yearly', wed)).toEqual({ frequency: 'yearly' });
    expect(recurrenceFor('monthly-last', d('2026-11-27T17:00:00'))).toEqual({ frequency: 'monthly', daysOfTheWeek: [{ dayOfTheWeek: 6, weekNumber: -1 }] });
    expect(recurrenceFor('weekdays', wed, FRI_SAT)?.daysOfTheWeek?.map((x) => x.dayOfTheWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(recurrenceFor(undefined, wed)).toBeUndefined();
  });
});
