import { describe, expect, it, vi } from 'vitest';

import { planSlots } from '@/lib/nudges';
import { routineState, routineWhen } from '@/lib/places';
import { awayDigest } from '@/lib/away';
import { quietDays, weekReview } from '@/lib/review';
import type { PlaceReminder } from '@/types/mnemo';

vi.mock('@/lib/notifications', () => ({ Notifications: {} }));
vi.mock('@/lib/reminders', () => ({ ensureReminderCategory: async () => {}, REMINDER_CATEGORY: 'reminder' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));

// A repeating place reminder is a routine: it waits for its place. It is never "gone quiet",
// never nudged, and Home shows where it stands today (rang, done, or when it can next ring).

const D = 864e5;
/** Sunday 22 November 2026, 09:00 local. Dhaka's weekend (Fri–Sat) is passed explicitly. */
const now = new Date(2026, 10, 22, 9).getTime();
const FRI_SAT = [5, 6];
const office: PlaceReminder = { placeId: 'office', on: 'arrive', setAt: now - 30 * D, repeat: 'weekdays', insideAtSet: false, sideAt: now - D };
const thread = (id: string, o: object = {}) =>
  ({ id, title: id, type: 'note', content: '', links: [], tags: [], category: 'personal', status: 'active', createdAt: now - 30 * D, updatedAt: now - 20 * D, ...o }) as never;

describe('a routine is not a stalled thread', () => {
  const mailbox = thread('mailbox', { place: office, nextStep: 'Bring up the parcels' });

  it('is never quiet in the weekly review, and its step is not "open"', () => {
    expect(quietDays(mailbox, [], now)).toBeNull();
    const r = weekReview([mailbox], [], now);
    expect([r.quiet.length, r.steps.length]).toEqual([0, 0]);
  });

  it('is never nudged; a thread with no reminder still is', () => {
    // Quiet for 5 days: inside the window a nudge covers (2–14 days).
    const recent = { updatedAt: now - 5 * D };
    const slots = planSlots([thread('mailbox', { place: office, ...recent }), thread('tap', recent)], { hour: 18, minute: 0 }, {}, now);
    expect(slots.map((s) => s.itemId)).toEqual(['tap']);
  });

  it('a one-off place reminder still set waits for its place too', () => {
    const keys = thread('keys', { place: { placeId: 'home', on: 'arrive', setAt: now - 20 * D }, updatedAt: now - 5 * D });
    expect(quietDays(keys, [], now)).toBeNull();
    expect(quietDays(thread('plain', { updatedAt: now - 10 * D }), [], now)).toBe(10);
    expect(planSlots([keys], { hour: 18, minute: 0 }, {}, now)).toEqual([]);
  });

  it('is left out of "while you were away": Home lists it under At places', () => {
    const d = awayDigest([mailbox, thread('tap', { nextStep: 'Buy a washer' })], [], now - 5 * D, now);
    expect(d.rows.map((r) => r.item.id)).toEqual(['tap']);
  });

  it('once it is finished, it is an ordinary thread again', () => {
    const fired = thread('old', { place: { ...office, repeat: undefined, firedAt: now - 20 * D } });
    expect(quietDays(fired, [], now)).toBe(20);
  });
});

describe('where a routine stands today', () => {
  it('waiting on one of its days: today', () => {
    expect(routineState(office, now, FRI_SAT)).toEqual({ state: 'waiting', next: 0 });
  });

  it('rang today and not done: rang, at that time', () => {
    const at = now + 60 * 60 * 1000;
    expect(routineState({ ...office, lastFiredAt: at }, at + 1000, FRI_SAT)).toEqual({ state: 'rang', at });
  });

  it('marked done: done, and next is its next day', () => {
    const at = now + 60 * 60 * 1000;
    expect(routineState({ ...office, lastFiredAt: at, doneAt: at + 5000 }, at + 10_000, FRI_SAT)).toEqual({ state: 'done', at, doneAt: at + 5000, next: 1 });
  });

  it('done on a Thursday: next is Sunday, after the Fri–Sat weekend', () => {
    const thu = new Date(2026, 10, 26, 10).getTime();
    const s = routineState({ ...office, lastFiredAt: thu, doneAt: thu + 1000 }, thu + 2000, FRI_SAT);
    expect(s).toMatchObject({ state: 'done', next: 3 });
    expect(routineWhen(3, thu)).toBe('Sun');
  });

  it('not one of its days: the next one that is', () => {
    const fridays: PlaceReminder = { ...office, repeat: 'days', days: [5] };
    expect(routineState(fridays, now, FRI_SAT)).toEqual({ state: 'waiting', next: 5 });
    expect(routineWhen(5, now)).toBe('Fri');
    expect(routineWhen(1, now)).toBe('Tomorrow');
  });

  it('a ring from yesterday is not still due today', () => {
    expect(routineState({ ...office, lastFiredAt: now - D }, now, FRI_SAT)).toEqual({ state: 'waiting', next: 0 });
  });
});
