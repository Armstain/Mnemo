import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What the phone is asked to ring, per kind of repeat and heads-up.
const scheduled: { identifier: string; trigger: Record<string, unknown>; content: Record<string, unknown> }[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
vi.mock('expo-constants', () => ({ default: {}, ExecutionEnvironment: {} }));
vi.mock('@/lib/places', async (orig) => ({ ...(await orig<typeof import('@/lib/places')>()), phoneWeekend: () => [6, 0] }));
vi.mock('@/lib/notifications', () => ({
  notificationsAvailable: true,
  CHANNELS: { reminders: 'reminder-alerts', nudges: 'nudges' },
  ACTIONS: { done: 'done', hour: 'hour', reply: 'reply' },
  ensureChannel: async () => {},
  hasNotificationPermission: async () => true,
  askNotificationPermission: async () => true,
  Notifications: {
    SchedulableTriggerInputTypes: { DATE: 'date', DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' },
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    setNotificationChannelAsync: async () => {},
    deleteNotificationChannelAsync: async () => {},
    setNotificationCategoryAsync: async () => {},
    getAllScheduledNotificationsAsync: async () => scheduled.map((s) => ({ identifier: s.identifier, trigger: s.trigger })),
    cancelScheduledNotificationAsync: async (id: string) => {
      const i = scheduled.findIndex((s) => s.identifier === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    scheduleNotificationAsync: async (r: { identifier: string; trigger: Record<string, unknown>; content: Record<string, unknown> }) => {
      const i = scheduled.findIndex((s) => s.identifier === r.identifier);
      if (i >= 0) scheduled.splice(i, 1);
      scheduled.push(r);
    },
  },
}));

const { syncReminderForItem, headsUpBody } = await import('@/lib/reminders');

const d = (s: string) => new Date(s).getTime();
const base = { id: 't1', title: 'Dentist', status: 'active' as const };

beforeEach(() => {
  scheduled.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(d('2026-11-14T10:00:00'));
});
afterEach(() => vi.useRealTimers());

const ids = () => scheduled.map((s) => s.identifier.replace(/:\d{10,}$/, ':<at>')).sort();

describe('scheduling', () => {
  it('a one-off appointment: the reminder, and a heads-up for each lead still ahead', async () => {
    await syncReminderForItem({ ...base, dueDate: d('2026-11-20T10:00:00'), leads: ['eve', 60] });
    expect(ids()).toEqual(['t1', 't1:lead:<at>', 't1:lead:<at>']);
    const heads = scheduled.filter((s) => s.identifier.includes(':lead:'));
    expect(heads.every((h) => h.content.categoryIdentifier === 'heads-up')).toBe(true);
    expect(heads.map((h) => h.trigger.date)).toEqual([new Date(d('2026-11-19T18:00:00')), new Date(d('2026-11-20T09:00:00'))]);
  });

  it('yearly: one alarm the phone repeats', async () => {
    await syncReminderForItem({ ...base, dueDate: d('2026-12-03T09:00:00'), repeat: 'yearly' });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].trigger).toMatchObject({ type: 'yearly', month: 11, day: 3, hour: 9, minute: 0 });
  });

  it('weekdays: a weekly alarm for each working day', async () => {
    await syncReminderForItem({ ...base, dueDate: d('2026-11-16T07:00:00'), repeat: 'weekdays' });
    expect(scheduled.map((s) => s.trigger.weekday)).toEqual([2, 3, 4, 5, 6]);
  });

  it('every other week: the next few times, and moving it replaces them all', async () => {
    await syncReminderForItem({ ...base, dueDate: d('2026-11-18T18:00:00'), repeat: 'every-2-weeks' });
    expect(scheduled.length).toBeGreaterThanOrEqual(3);
    expect(scheduled.every((s) => s.identifier.startsWith('t1:occ:'))).toBe(true);
    expect(scheduled[1].trigger.date).toEqual(new Date(d('2026-12-02T18:00:00')));
    await syncReminderForItem({ ...base, dueDate: d('2026-11-20T10:00:00') });
    expect(ids()).toEqual(['t1']);
  });

  it('a repeating reminder has no heads-ups', async () => {
    await syncReminderForItem({ ...base, dueDate: d('2026-11-16T09:00:00'), repeat: 'weekly', leads: ['eve'] });
    expect(ids()).toEqual(['t1']);
  });

  it('a heads-up says how soon, as read when it rings', () => {
    const due = d('2026-11-20T10:00:00');
    expect(headsUpBody(due, d('2026-11-20T09:00:00'))).toMatch(/^In 1 hour, at 10:00/);
    expect(headsUpBody(due, d('2026-11-20T09:45:00'), 'Bring the X-rays')).toMatch(/^In 15 minutes, at 10:00.* · Bring the X-rays$/);
    expect(headsUpBody(due, d('2026-11-19T18:00:00'))).toMatch(/^Tomorrow, 10:00/);
  });
});
