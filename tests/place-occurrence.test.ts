import { afterEach, describe, expect, it } from 'vitest';
import { afterCrossing, completeOccurrence, isArmed, occurrenceOf, onPlaceEvent, ringNow, weekendDays } from '@/lib/places';
import type { PlaceReminder } from '@/types/mnemo';

// A repeating place reminder is a definition that rings at most once a day; each ring is an
// occurrence, and Done completes that occurrence only (docs/audits/tasks-and-reminders-2026-11.md, P2).

const WEST = [6, 0];
const startTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = startTz;
});

/** Local time on a weekday (0 = Sunday) of the week of Sunday 4 January 2026. */
function on(weekday: number, hour = 9, minute = 0, weekOffset = 0): number {
  const d = new Date(2026, 0, 4, hour, minute);
  d.setDate(d.getDate() + weekday + weekOffset * 7);
  expect(d.getDay()).toBe(weekday);
  return d.getTime();
}

const office = (extra: Partial<PlaceReminder> = {}): PlaceReminder => ({
  placeId: 'office',
  on: 'arrive',
  repeat: 'weekdays',
  setAt: on(0, 20),
  insideAtSet: false,
  ...extra,
});

/** One arrival and the evening's leaving, as the phone reports them; returns whether it rang. */
function arriveAndLeave(r: PlaceReminder, arriveAt: number, weekend = WEST): { r: PlaceReminder; rang: boolean } {
  const action = onPlaceEvent(r, 'enter', arriveAt, 0);
  let next = r;
  let rang = false;
  if (action === 'fire') {
    rang = ringNow(next, arriveAt, weekend);
    next = afterCrossing(next, arriveAt, rang);
  }
  return { r: { ...next, ...(onPlaceEvent(next, 'exit', arriveAt + 9 * 3600_000, 0) === 'outside' ? { insideAtSet: false } : {}) }, rang };
}

describe('a weekday place reminder, day by day', () => {
  it('Monday: rings, Done completes Monday only, and the reminder itself is untouched', () => {
    let r = office();
    const monday = arriveAndLeave(r, on(1));
    expect(monday.rang).toBe(true);
    r = monday.r;
    expect(occurrenceOf(r, on(1, 12))).toEqual({ state: 'due', at: on(1) });

    const done = completeOccurrence(r, on(1, 12))!;
    expect(done).not.toBeNull();
    expect(occurrenceOf(done, on(1, 13)).state).toBe('done');
    // The definition: same place, side, repeat; still armed; no firedAt (that would end it).
    expect(done).toMatchObject({ placeId: 'office', on: 'arrive', repeat: 'weekdays', setAt: r.setAt });
    expect(done.firedAt).toBeUndefined();
    expect(isArmed({ place: done, status: 'active' })).toBe(true);
  });

  it('Tuesday rings on its own after Monday was done; Wednesday after Tuesday was done', () => {
    let r = office();
    r = arriveAndLeave(r, on(1)).r;
    r = completeOccurrence(r, on(1, 12))!;

    const tuesday = arriveAndLeave(r, on(2));
    expect(tuesday.rang).toBe(true);
    // A new occurrence: Monday's Done doesn't carry over.
    expect(occurrenceOf(tuesday.r, on(2, 10)).state).toBe('due');
    r = completeOccurrence(tuesday.r, on(2, 12))!;

    const wednesday = arriveAndLeave(r, on(3));
    expect(wednesday.rang).toBe(true);
    expect(occurrenceOf(wednesday.r, on(3, 10)).state).toBe('due');
  });

  it('completing one occurrence can never complete the next ones', () => {
    let r = office();
    for (const day of [1, 2, 3, 4, 5]) {
      const visit = arriveAndLeave(r, on(day));
      expect(visit.rang).toBe(true);
      r = completeOccurrence(visit.r, on(day, 12))!;
      expect(occurrenceOf(r, on(day + 1 > 6 ? 0 : day + 1, 8)).state).toBe('none');
    }
    // Weekend: not a ring day, and nothing is pending.
    expect(arriveAndLeave(r, on(6)).rang).toBe(false);
  });

  it('Done twice (a double tap, a replayed notification) changes nothing the second time', () => {
    const r = arriveAndLeave(office(), on(1)).r;
    const once = completeOccurrence(r, on(1, 12))!;
    expect(completeOccurrence(once, on(1, 12, 1))).toBeNull();
  });

  it('done before it rang (did it early): today is skipped, tomorrow rings', () => {
    const early = completeOccurrence(office(), on(2, 7))!;
    expect(occurrenceOf(early, on(2, 8)).state).toBe('done');
    expect(arriveAndLeave(early, on(2)).rang).toBe(false);
    expect(arriveAndLeave(early, on(3)).rang).toBe(true);
  });

  it('a ring nobody marked done lapses at midnight: an old occurrence is never shown as still due', () => {
    const r = arriveAndLeave(office(), on(3)).r;
    expect(occurrenceOf(r, on(3, 22)).state).toBe('due');
    expect(occurrenceOf(r, on(4, 7)).state).toBe('none');
    // Missed days while the app was closed don't pile up: Friday rings once, as usual.
    expect(arriveAndLeave(r, on(5)).rang).toBe(true);
  });

  it('survives a restart: what is stored (JSON) reads back as the same definition and state', () => {
    let r = arriveAndLeave(office(), on(1)).r;
    r = completeOccurrence(r, on(1, 12))!;
    const reloaded = JSON.parse(JSON.stringify(r)) as PlaceReminder;
    expect(reloaded).toEqual(r);
    expect(occurrenceOf(reloaded, on(1, 13)).state).toBe('done');
    expect(arriveAndLeave(reloaded, on(2)).rang).toBe(true);
  });

  it('records written before occurrences existed (no doneAt) keep working', () => {
    const legacy: PlaceReminder = { placeId: 'office', on: 'arrive', repeat: 'weekdays', setAt: 0, insideAtSet: false, lastFiredAt: on(1) };
    expect(occurrenceOf(legacy, on(1, 12)).state).toBe('due');
    expect(arriveAndLeave(legacy, on(2)).rang).toBe(true);
  });
});

describe('a one-shot place reminder', () => {
  it('its single ring can be marked done; before ringing there is nothing to complete', () => {
    const once: PlaceReminder = { placeId: 'shop', on: 'arrive', setAt: 0, insideAtSet: false };
    expect(completeOccurrence(once, on(1))).toBeNull();
    const fired = afterCrossing(once, on(1), true);
    expect(occurrenceOf(fired, on(1, 10)).state).toBe('due');
    expect(occurrenceOf(completeOccurrence(fired, on(1, 10))!, on(1, 11)).state).toBe('done');
  });
});

describe('time zones: the day is the phone’s local day', () => {
  it('Bangladesh: weekdays are Sunday–Thursday, and a ring at 23:30 and one at 00:30 are different days', () => {
    process.env.TZ = 'Asia/Dhaka';
    const bd = weekendDays('Asia/Dhaka', 'en-US');
    expect(bd).toEqual([5, 6]);
    const sunday = new Date(2026, 0, 4, 9).getTime();
    const friday = new Date(2026, 0, 9, 9).getTime();
    expect(ringNow({ repeat: 'weekdays' }, sunday, bd)).toBe(true);
    expect(ringNow({ repeat: 'weekdays' }, friday, bd)).toBe(false);

    const lateMon = new Date(2026, 0, 5, 23, 30).getTime();
    const earlyTue = new Date(2026, 0, 6, 0, 30).getTime();
    const r = { ...office(), lastFiredAt: lateMon, doneAt: lateMon + 60_000 };
    expect(occurrenceOf(r, lateMon + 120_000).state).toBe('done');
    expect(occurrenceOf(r, earlyTue).state).toBe('none');
    expect(ringNow(r, earlyTue, bd)).toBe(true);
  });

  it('the same instant is a different day in another zone, and the day follows the phone', () => {
    // 2026-01-05 20:00 UTC: Monday evening in London, already Tuesday 02:00 in Dhaka.
    const instant = Date.UTC(2026, 0, 5, 20);
    const ringMonday = Date.UTC(2026, 0, 5, 9);
    process.env.TZ = 'Europe/London';
    expect(occurrenceOf({ repeat: 'always', lastFiredAt: ringMonday }, instant).state).toBe('due');
    process.env.TZ = 'Asia/Dhaka';
    expect(occurrenceOf({ repeat: 'always', lastFiredAt: ringMonday }, instant).state).toBe('none');
  });
});
