import { describe, expect, it } from 'vitest';
import {
  afterCrossing,
  isArmed,
  onPlaceEvent,
  placeLabel,
  readPlaceReminder,
  readPlaceRepeat,
  repeatDays,
  ringNow,
  weekendDays,
} from '@/lib/places';
import type { Place, PlaceReminder } from '@/types/mnemo';

const BD = [5, 6];
const WEST = [6, 0];

/** 10:00 local on the next given weekday (0 = Sunday), counted from a fixed week. */
function on(weekday: number, hour = 10, weekOffset = 0): number {
  const d = new Date(2026, 0, 4, hour); // Sunday 4 January 2026
  d.setDate(d.getDate() + weekday + weekOffset * 7);
  expect(d.getDay()).toBe(weekday);
  return d.getTime();
}

const arrive = (extra: Partial<PlaceReminder> = {}): PlaceReminder => ({ placeId: 'o', on: 'arrive', setAt: 0, insideAtSet: false, ...extra });

describe('the weekend is the phone’s, not always Saturday–Sunday', () => {
  it('Bangladesh by time zone, even with the language set to US English', () => {
    expect(weekendDays('Asia/Dhaka', 'en-US')).toEqual(BD);
  });
  it('by region when the time zone says nothing', () => {
    expect(weekendDays('UTC', 'bn-BD')).toEqual(BD);
    expect(weekendDays(undefined, 'ar-SA')).toEqual(BD);
  });
  it('one-day weekends, and the usual Saturday–Sunday otherwise', () => {
    expect(weekendDays('Asia/Tehran')).toEqual([5]);
    expect(weekendDays('America/New_York', 'en-US')).toEqual(WEST);
    expect(weekendDays()).toEqual(WEST);
  });
  it('the chips name the days', () => {
    expect(repeatDays('weekdays', BD)).toBe('Sun–Thu');
    expect(repeatDays('weekends', BD)).toBe('Fri–Sat');
    expect(repeatDays('weekdays', WEST)).toBe('Mon–Fri');
    expect(repeatDays('weekends', WEST)).toBe('Sat–Sun');
    expect(repeatDays('weekdays', [5])).toBe('Sat–Thu');
    expect(repeatDays('weekends', [5])).toBe('Fri');
  });
});

describe('whether a crossing rings', () => {
  it('once: always (it is then done)', () => {
    expect(ringNow(arrive(), on(5), BD)).toBe(true);
  });
  it('weekdays: not on the weekend, and the weekend depends on where you are', () => {
    const r = arrive({ repeat: 'weekdays' });
    expect(ringNow(r, on(5), BD)).toBe(false); // Friday in Dhaka
    expect(ringNow(r, on(0), BD)).toBe(true); // Sunday in Dhaka is a workday
    expect(ringNow(r, on(0), WEST)).toBe(false);
    expect(ringNow(r, on(5), WEST)).toBe(true);
  });
  it('weekends: only then', () => {
    const r = arrive({ repeat: 'weekends' });
    expect(ringNow(r, on(6), BD)).toBe(true);
    expect(ringNow(r, on(2), BD)).toBe(false);
  });
  it('at most once a day: a second visit, or the edge of the circle bouncing, stays quiet', () => {
    const r = arrive({ repeat: 'always', lastFiredAt: on(2, 9) });
    expect(ringNow(r, on(2, 9) + 10 * 60 * 1000, BD)).toBe(false);
    expect(ringNow(r, on(2, 18), BD)).toBe(false);
    // The next morning is a new day, even under 24 hours later.
    expect(ringNow(r, on(3, 7), BD)).toBe(true);
  });
});

describe('after a crossing', () => {
  it('a one-shot that rang is done', () => {
    const next = afterCrossing(arrive(), 5, true);
    expect(next.firedAt).toBe(5);
    expect(isArmed({ status: 'active', place: next })).toBe(false);
  });
  it('a repeating one stays armed, on the side the phone is now on', () => {
    const next = afterCrossing(arrive({ repeat: 'always' }), 5, true);
    expect(next.firedAt).toBeUndefined();
    expect(next.lastFiredAt).toBe(5);
    expect(next.insideAtSet).toBe(true);
    expect(isArmed({ status: 'active', place: next })).toBe(true);
    const left = afterCrossing({ placeId: 'h', on: 'leave', setAt: 0, insideAtSet: true, repeat: 'weekdays' }, 5, true);
    expect(left.insideAtSet).toBe(false);
  });
  it('held back (wrong day, rang today): only the side is noted, so the next real crossing counts', () => {
    const next = afterCrossing(arrive({ repeat: 'weekdays', lastFiredAt: 1 }), 5, false);
    expect(next).toMatchObject({ insideAtSet: true, lastFiredAt: 1 });
    expect(next.firedAt).toBeUndefined();
  });
  it('a late catch is marked; the next on-time ring clears it', () => {
    const late = afterCrossing(arrive({ repeat: 'always' }), 5, true, true);
    expect(late.caughtLate).toBe(true);
    expect(afterCrossing({ ...late, insideAtSet: false }, 9, true).caughtLate).toBeUndefined();
  });
});

describe('a weekday reminder for the office, over a week (Dhaka)', () => {
  it('rings arriving Sunday and Monday, not twice in a day, not on Friday', () => {
    let r = arrive({ repeat: 'weekdays' });
    const rang: number[] = [];
    // [time, event]: arrive and leave each day; a second arrival Sunday afternoon.
    const days: [number, 'enter' | 'exit'][] = [
      [on(0, 9), 'enter'],
      [on(0, 13), 'exit'],
      [on(0, 14), 'enter'],
      [on(0, 18), 'exit'],
      [on(1, 9), 'enter'],
      [on(1, 18), 'exit'],
      [on(5, 9), 'enter'],
      [on(5, 18), 'exit'],
      [on(0, 9, 1), 'enter'],
    ];
    for (const [at, event] of days) {
      const action = onPlaceEvent(r, event, at, 0);
      if (action === 'fire') {
        const ring = ringNow(r, at, BD);
        if (ring) rang.push(at);
        r = afterCrossing(r, at, ring);
      } else if (action === 'inside' || action === 'outside') {
        r = { ...r, insideAtSet: action === 'inside' };
      }
    }
    expect(rang).toEqual([on(0, 9), on(1, 9), on(0, 9, 1)]);
    expect(isArmed({ status: 'active', place: r })).toBe(true);
  });
});

describe('reading how often from the note', () => {
  const office: Place = { id: 'o', name: 'Office', latitude: 0, longitude: 0, radius: 150, accuracy: 20, savedAt: 0 };
  const home: Place = { id: 'h', name: 'Home', latitude: 1, longitude: 1, radius: 150, accuracy: 20, savedAt: 0 };
  it('weekdays, weekends, every time; nothing said: once', () => {
    expect(readPlaceReminder('every weekday when I get to the office check the mail', [office])).toEqual({ placeId: 'o', on: 'arrive', repeat: 'weekdays' });
    expect(readPlaceReminder('whenever I leave home take the keys', [home])).toEqual({ placeId: 'h', on: 'leave', repeat: 'always' });
    expect(readPlaceReminder('on weekends when I get home water the plants', [home])).toEqual({ placeId: 'h', on: 'arrive', repeat: 'weekends' });
    expect(readPlaceReminder('when I get to the office call Rahim', [office])).toEqual({ placeId: 'o', on: 'arrive' });
  });
  it('Banglish and Bangla', () => {
    expect(readPlaceRepeat('protidin office e gele attendance dite hobe')).toBe('always');
    expect(readPlaceRepeat('প্রতিদিন অফিসে গেলে')).toBe('always');
    expect(readPlaceRepeat('ছুটির দিনে বাসায় গেলে')).toBe('weekends');
  });
  it('the label says it', () => {
    expect(placeLabel({ on: 'arrive', repeat: 'weekdays' }, { name: 'Office' })).toBe('When you get to Office, on weekdays');
    expect(placeLabel({ on: 'leave' }, { name: 'Home' })).toBe('When you leave Home');
  });
});
