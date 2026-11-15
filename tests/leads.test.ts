import { describe, expect, it, vi } from 'vitest';

import { cleanLeads, isAppointment, leadAt, leadsSummary, leadTimes } from '@/lib/leads';
import { understand } from '@/lib/understand';
import { foldReminders } from '@/lib/reminder-ownership';
import { undoFor } from '@/lib/saved-notice';

// Hoisted by vitest above the imports.
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
vi.mock('expo-constants', () => ({ default: {}, ExecutionEnvironment: {} }));
vi.mock('@/lib/errors', () => ({ logError: () => {} }));
vi.mock('@/lib/notifications', () => ({ notificationsAvailable: false, Notifications: null }));

const d = (s: string) => new Date(s).getTime();

describe('heads-ups before an appointment', () => {
  const due = d('2026-11-20T10:00:00');

  it('ring at the chosen times, soonest first', () => {
    const now = d('2026-11-15T12:00:00');
    expect(leadTimes(due, ['eve', 60, 7 * 24 * 60], now).map((l) => l.at)).toEqual([d('2026-11-19T18:00:00'), d('2026-11-20T09:00:00')]);
    expect(leadAt(due, 24 * 60)).toBe(d('2026-11-19T10:00:00'));
  });

  it('none that has passed, and none after the reminder', () => {
    expect(leadTimes(due, ['eve', 60], d('2026-11-19T20:00:00')).map((l) => l.lead)).toEqual([60]);
    expect(leadTimes(due, ['eve', 60], d('2026-11-20T09:30:00'))).toEqual([]);
    expect(leadTimes(due, undefined, d('2026-11-15T12:00:00'))).toEqual([]);
  });

  it('two in the same minute ring once', () => {
    const at = d('2026-11-20T19:00:00');
    // 1 day before is 19:00 the day before; the evening before is 18:00: both stay.
    expect(leadTimes(at, ['eve', 24 * 60], d('2026-11-15T00:00:00'))).toHaveLength(2);
    const six = d('2026-11-20T18:00:00');
    expect(leadTimes(six, ['eve', 24 * 60], d('2026-11-15T00:00:00'))).toHaveLength(1);
  });

  it('keeps only known choices, and says them plainly', () => {
    expect(cleanLeads([60, 'eve', 'soon', 61, 60])).toEqual(['eve', 60]);
    expect(cleanLeads('eve')).toEqual([]);
    expect(leadsSummary(['eve', 60])).toBe('The evening before, 1 hour before');
    expect(leadsSummary([])).toBe('No heads-up');
  });
});

describe('what counts as an appointment', () => {
  it.each([
    ['dentist tomorrow at 10', true],
    ['meeting with Sara on Friday at 3pm', true],
    ['lunch with Rumi tomorrow at 1', true],
    ['remind me about the doctor appointment on monday at 9', true],
    ['flight to Dhaka on dec 20 at 6am', true],
    ['ডাক্তার কাল সকাল ১০টায়', true],
    ['call the bank at 3', false],
    ['pay rent tomorrow', false],
    ['remind me in 20 minutes to take the laundry out', false],
    ['test the build tomorrow at 10', false],
  ])('%s → %s', (said, yes) => {
    expect(isAppointment(said)).toBe(yes);
  });

  it('is read with the note, only for a one-off time', () => {
    const now = d('2026-11-14T10:00:00');
    expect(understand('dentist tomorrow at 10', { now }).appointment).toBe(true);
    expect(understand('call the bank tomorrow at 3pm', { now }).appointment).toBeUndefined();
    expect(understand('yoga class every monday at 7pm', { now }).appointment).toBeUndefined();
    expect(understand('dentist sometime', { now }).appointment).toBeUndefined();
  });
});

describe('a reminder moving to another thread', () => {
  it('takes its heads-ups and calendar event along when it becomes that thread’s own', () => {
    const now = d('2026-11-14T10:00:00');
    const from = { title: 'Dentist', status: 'active' as const, dueDate: d('2026-11-20T10:00:00'), leads: ['eve' as const, 60], inCalendar: true };
    const to = { title: 'Teeth', status: 'active' as const };
    const fold = foldReminders(from, to, now);
    expect(fold.ok && fold.carry).toMatchObject({ dueDate: from.dueDate, leads: ['eve', 60], inCalendar: true });
    // Queued behind the other thread's own reminder: a step, without heads-ups.
    const busy = { ...to, dueDate: d('2026-11-18T10:00:00') };
    const queued = foldReminders(from, busy, now);
    expect(queued.ok && queued.carry.leads).toBeUndefined();
  });
});

describe('Undo on "Reminder set"', () => {
  const before = { dueDate: undefined, repeat: undefined, laterSteps: undefined, leads: undefined, inCalendar: undefined };
  it('puts back what was there, heads-ups and calendar too', () => {
    const at = d('2026-11-20T10:00:00');
    expect(undoFor({ dueDate: at }, { at, before: { ...before, dueDate: d('2026-11-18T09:00:00'), repeat: 'weekly' } })).toEqual({
      ...before,
      dueDate: d('2026-11-18T09:00:00'),
      repeat: 'weekly',
    });
  });
  it('leaves a reminder changed since alone', () => {
    expect(undoFor({ dueDate: d('2026-11-21T10:00:00') }, { at: d('2026-11-20T10:00:00'), before })).toBeNull();
  });
});
