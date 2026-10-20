import { describe, expect, it } from 'vitest';
import { formatReminder, hasTime, nextOccurrence, quickTimes, resumeOrder, resumeReason } from '@/lib/when';

const mon = new Date('2026-10-12T10:00:00').getTime();
const d = (s: string) => new Date(s).getTime();

describe('reminders', () => {
  it('repeating reminders roll forward', () => {
    expect(nextOccurrence(d('2026-10-11T08:30:00'), 'daily', mon)).toBe(d('2026-10-13T08:30:00'));
    expect(nextOccurrence(d('2026-10-05T09:00:00'), 'weekly', mon)).toBe(d('2026-10-19T09:00:00'));
    expect(nextOccurrence(d('2026-01-31T09:00:00'), 'monthly', d('2026-02-02T00:00:00'))).toBe(d('2026-02-28T09:00:00'));
    expect(nextOccurrence(d('2026-10-20T09:00:00'), 'daily', mon)).toBe(d('2026-10-20T09:00:00'));
  });

  it('quick choices that are still ahead', () => {
    expect(quickTimes(mon).map((q) => q.key)).toEqual(['evening', 'tomorrow', 'weekend', 'nextweek']);
    expect(quickTimes(d('2026-10-17T20:00:00')).map((q) => q.key)).not.toContain('weekend');
  });

  it('labels', () => {
    expect(formatReminder(d('2026-10-13T09:00:00'), mon)).toMatch(/^Tomorrow, 9:00/);
    expect(hasTime(d('2026-10-13T23:59:59.999'))).toBe(false);
  });

  it('what to pick up: pinned, then attention', () => {
    const t = (id: string, o: object) => ({ id, status: 'active', updatedAt: mon - 3600e3, ...o }) as never;
    const order = resumeOrder(
      [t('old', { updatedAt: mon - 10 * 864e5 }), t('recent', {}), t('pinned', { starred: true, updatedAt: mon - 30 * 864e5 }), t('due', { updatedAt: mon - 5 * 864e5, dueDate: mon + 3600e3 })],
      { now: mon },
    ).map((x: { id: string }) => x.id);
    expect(order).toEqual(['pinned', 'recent', 'due', 'old']);
  });
});

describe('why a thread is on top of Home', () => {
  const t = (o: object) => ({ id: 'a', status: 'active', updatedAt: mon - 2 * 864e5, ...o }) as never;
  const kind = (o: object, focusId?: string) => resumeReason(t(o), { now: mon, focusId })?.kind ?? null;

  it('a reminder missed or due within a day wins', () => {
    expect(kind({ dueDate: mon - 3600e3, starred: true })).toBe('missed');
    expect(kind({ dueDate: mon + 5 * 3600e3, starred: true })).toBe('due');
  });

  it('a repeating reminder is never missed: its next time counts', () => {
    expect(kind({ dueDate: d('2026-10-11T18:00:00'), repeat: 'daily' })).toBe('due');
    expect(kind({ dueDate: d('2026-10-05T09:00:00'), repeat: 'weekly' })).toBeNull();
  });

  it('then pinned, then the focus thread, then touched in the last few hours', () => {
    expect(kind({ dueDate: mon + 3 * 864e5, starred: true })).toBe('starred');
    expect(kind({}, 'a')).toBe('focus');
    expect(kind({ updatedAt: mon - 3600e3 })).toBe('recent');
    expect(kind({ lastResumedAt: mon - 3600e3 })).toBe('recent');
  });

  it('otherwise there is nothing to say', () => {
    expect(kind({})).toBeNull();
  });
});
