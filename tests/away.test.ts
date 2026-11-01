import { describe, expect, it } from 'vitest';
import { AWAY_DAYS, KEEP_SHOWING_MS, awayDigest, awayFor, onAppActive, onAppBackground } from '@/lib/away';

const now = new Date('2026-10-20T09:00:00').getTime();
const D = 864e5;
const thread = (id: string, o: object = {}) =>
  ({ id, title: id, type: 'note', content: '', links: [], tags: [], category: 'work', status: 'active', createdAt: now - 30 * D, updatedAt: now - 9 * D, ...o }) as never;
const entry = (id: string, threadId: string, at: number) =>
  ({ id, threadId, createdAt: at, updatedAt: at, source: 'text', filing: { by: 'user' }, blocks: [] }) as never;

describe('when "welcome back" shows', () => {
  it('not on the first open, nor after a short break', () => {
    expect(onAppActive({}, now).since).toBeUndefined();
    expect(onAppActive({ lastSeenAt: now - D }, now).since).toBeUndefined();
  });
  it(`after ${AWAY_DAYS} days away, counted from when they left`, () => {
    const s = onAppActive({ lastSeenAt: now - 8 * D }, now);
    expect(s).toEqual({ lastSeenAt: now, since: now - 8 * D, returnedAt: now });
  });
  it('stays across reopens for a while, then goes', () => {
    const back = onAppActive(onAppBackground(onAppActive({ lastSeenAt: now - 8 * D }, now), now + 60_000), now + 3600_000);
    expect(back.since).toBe(now - 8 * D);
    expect(onAppActive(back, now + KEEP_SHOWING_MS + 1).since).toBeUndefined();
  });
});

describe('what’s waiting', () => {
  const since = now - 8 * D;
  const items = [
    thread('rent', { kind: 'task', nextStep: 'Pay rent', dueDate: now - 2 * D }),
    thread('dentist', { kind: 'task', nextStep: 'Call the dentist', dueDate: now + D }),
    thread('portfolio', { kind: 'project', nextStep: 'Write the case study', updatedAt: now - 9 * D }),
    thread('garden', { kind: 'project', whereLeftOff: 'Seeds ordered, waiting for soil', updatedAt: now - 20 * D }),
    thread('podcast', { kind: 'idea' }),
    thread('number', {}),
    thread('paused', { kind: 'task', nextStep: 'Later', status: 'paused' }),
  ];
  const entries = [entry('1', 'portfolio', now - 9 * D), entry('2', 'number', now - 2 * D)];
  const d = awayDigest(items, entries, since, now);

  it('missed first, then due soon, then steps, then where projects were left', () => {
    expect(d.rows.map((r) => [r.item.id, r.reason.kind])).toEqual([
      ['rent', 'missed'],
      ['dentist', 'due'],
      ['portfolio', 'step'],
      ['garden', 'leftOff'],
    ]);
    expect(d.rows[3].text).toBe('Seeds ordered, waiting for soil');
  });
  it('says it in one line', () => {
    expect(d.days).toBe(8);
    expect(d.line).toBe('One reminder passed, two things to do and two projects have gone quiet.');
    expect([d.ideas, d.added]).toEqual([1, 1]);
  });
  it('leaves out what the Resume card shows', () => {
    expect(awayDigest(items, entries, since, now, 'rent').rows[0].item.id).toBe('dentist');
  });
  it('nothing waiting', () => {
    expect(awayDigest([thread('podcast', { kind: 'idea' })], [], since, now).line).toBe(
      'Nothing overdue. One idea is waiting when you have a moment.',
    );
    expect(awayDigest([], [], since, now).line).toBe('Nothing slipped while you were gone.');
  });
  it('time away in words', () => {
    expect([awayFor(3), awayFor(7), awayFor(8), awayFor(21), awayFor(90)]).toEqual(['3 days', 'a week', '8 days', '3 weeks', '3 months']);
  });
});
