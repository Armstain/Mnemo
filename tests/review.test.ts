import { describe, expect, it } from 'vitest';
import { reviewLine, weekReview } from '@/lib/review';
import { openStepsOf, spanLabel, wrapText, wrapThread } from '@/lib/wrapup';
import { quietDays, shortLine } from '@/lib/review';

const now = new Date('2026-10-12T10:00:00').getTime();
const D = 864e5;
const thread = (id: string, o: object = {}) =>
  ({ id, title: id, type: 'note', content: '', links: [], tags: [], category: 'personal', status: 'active', createdAt: now - 30 * D, updatedAt: now - 30 * D, ...o }) as never;
const entry = (id: string, threadId: string, at: number, o: object = {}) =>
  ({ id, threadId, createdAt: at, updatedAt: at, source: 'text', filing: { by: 'user' }, blocks: [], ...o }) as never;
const spent = (value: number, group: string) => ({ kind: 'measures', items: [{ metric: 'spent', value, unit: 'BDT', label: group, group, rollup: 'sum' }] });

describe('weekly review', () => {
  const items = [
    thread('trip', { nextStep: 'Book the bus', updatedAt: now - 1 * D }),
    thread('pitch', { nextStep: 'Send the draft', dueDate: now + 2 * D, updatedAt: now - 2 * D }),
    thread('kitchen', { updatedAt: now - 10 * D }),
    thread('old', { updatedAt: now - 90 * D }),
    thread('paused', { status: 'paused', updatedAt: now - 20 * D }),
    thread('done', { status: 'completed', updatedAt: now - 3 * D }),
  ];
  const entries = [
    entry('1', 'trip', now - 1 * D, { blocks: [spent(1500, 'transport')] }),
    entry('2', 'trip', now - 2 * D, { blocks: [spent(3500, 'stay')] }),
    entry('3', 'run', now - 3 * D, { blocks: [{ kind: 'measures', items: [{ metric: 'ran', value: 5, unit: 'km', rollup: 'sum' }] }] }),
    entry('4', 'trip', now - 20 * D, { blocks: [spent(999, 'food')] }),
    entry('5', 'pitch', now - 2 * D),
  ];
  const r = weekReview(items, entries, now);

  it('counts the week', () => {
    expect(r.notes).toBe(4);
    expect(r.threadsTouched).toBe(3);
  });
  it('due first, then steps without a reminder', () => {
    expect(r.due.map((d) => [d.item.id, d.missed])).toEqual([['pitch', false]]);
    expect(r.steps.map((t: { id: string }) => t.id)).toEqual(['trip']);
  });
  it('quiet: a week or more, not forgotten, not paused', () => {
    expect(r.quiet.map((q) => [q.item.id, q.days])).toEqual([['kitchen', 10]]);
  });
  it('a quiet thread with a step is listed once, under quiet', () => {
    const q = weekReview([thread('shed', { nextStep: 'Paint the door', updatedAt: now - 12 * D })], [], now);
    expect([q.steps.length, q.quiet.length]).toEqual([0, 1]);
  });
  it('totals only this week, across threads', () => {
    expect(r.totals).toEqual([
      { metric: 'spent', unit: 'BDT', total: 5000, count: 2, threads: 1 },
      { metric: 'ran', unit: 'km', total: 5, count: 1, threads: 1 },
    ]);
  });
  it('finished this week', () => {
    expect(r.finished.map((t: { id: string }) => t.id)).toEqual(['done']);
  });
  it('seven calendar days ending today, notes per day', () => {
    expect(new Date(r.from).toString()).toContain('Oct 06 2026 00:00');
    expect(r.days).toHaveLength(7);
    expect(r.days.map((d) => d.notes)).toEqual([0, 0, 0, 1, 2, 1, 0]);
    expect(r.days.reduce((n, d) => n + d.notes, 0)).toBe(r.notes);
  });
  it('home line', () => {
    expect(shortLine(r)).toBe('4 notes · 2 steps open · 1 quiet');
    expect(shortLine(weekReview([], [], now))).toBe('');
  });
  it('one line for the notification', () => {
    expect(reviewLine(r, (t) => `${t.metric} ${t.total}`)).toBe('4 notes in 3 threads, spent 5000, 2 steps open, 1 gone quiet.');
  });
});

describe('edge cases', () => {
  it('a missed reminder is listed as missed; a month-old one is just quiet', () => {
    const r = weekReview(
      [thread('call', { dueDate: now - 2 * D, updatedAt: now - 10 * D }), thread('ancient', { dueDate: now - 40 * D, updatedAt: now - 45 * D })],
      [],
      now,
    );
    expect(r.due.map((d) => [d.item.id, d.missed])).toEqual([['call', true]]);
    expect(r.quiet.map((q) => q.item.id)).toEqual(['ancient']);
  });
  it('a repeating reminder is never missed, and never quiet', () => {
    const plants = thread('plants', { dueDate: now - 13 * D, repeat: 'weekly', updatedAt: now - 20 * D });
    const r = weekReview([plants], [], now);
    expect(r.due.map((d) => [d.item.id, d.missed, d.at - now])).toEqual([['plants', false, D]]);
    expect(quietDays(plants, [], now)).toBeNull();
  });
  it('waiting on a reminder later than a week: not quiet, not due', () => {
    const r = weekReview([thread('visa', { dueDate: now + 20 * D, updatedAt: now - 15 * D })], [], now);
    expect([r.due.length, r.quiet.length]).toEqual([0, 0]);
  });
  it('"still on it" holds the question off until then', () => {
    const t = thread('shed', { updatedAt: now - 12 * D, quietUntil: now + 5 * D });
    expect(quietDays(t, [], now)).toBeNull();
    expect(quietDays(t, [], now + 6 * D)).toBe(18);
  });
  it('paused and pending threads are never quiet', () => {
    expect(quietDays(thread('p', { status: 'paused', updatedAt: now - 20 * D }), [], now)).toBeNull();
    expect(quietDays(thread('q', { pending: true, updatedAt: now - 20 * D }), [], now)).toBeNull();
  });
  it('a recent note keeps a thread from being quiet', () => {
    const t = thread('shed', { updatedAt: now - 12 * D });
    expect(quietDays(t, [entry('x', 'shed', now - 2 * D)], now)).toBeNull();
  });
  it('finished means finished this week, not edited this week', () => {
    const r = weekReview(
      [
        thread('renamed', { status: 'completed', completedAt: now - 90 * D, updatedAt: now - 1 * D }),
        thread('legacy', { status: 'completed', updatedAt: now - 1 * D }),
        thread('reopened', { status: 'active', completedAt: now - 1 * D, updatedAt: now - 1 * D }),
      ],
      [],
      now,
    );
    expect(r.finished.map((t: { id: string }) => t.id)).toEqual(['legacy']);
  });
  it('steps done this week', () => {
    const r = weekReview([], [entry('s', 'x', now - 9 * D, { nextStep: 'Call', stepDone: true, updatedAt: now - D }), entry('o', 'x', now - 9 * D, { nextStep: 'Old', stepDone: true, updatedAt: now - 9 * D })], now);
    expect(r.stepsDone).toBe(1);
  });
  it('a quiet week says so', () => {
    expect(reviewLine(weekReview([], [], now), () => '')).toBe('A quiet week. Anything to pick back up?');
  });
});

describe('wrapping up a thread', () => {
  const t = thread('Sylhet trip', { id: 'trip', createdAt: new Date('2026-10-09T09:00').getTime() });
  const entries = [
    entry('a', 'trip', new Date('2026-10-09T12:00').getTime(), { source: 'voice', blocks: [spent(3500, 'stay')] }),
    entry('b', 'trip', new Date('2026-10-11T12:00').getTime(), { blocks: [spent(1500, 'transport'), { kind: 'image', file: 'x.jpg', width: 1, height: 1 }], nextStep: 'Book the bus', stepDone: true }),
    entry('c', 'trip', new Date('2026-10-12T08:00').getTime(), { nextStep: 'Send photos to Rumi' }),
  ];
  const w = wrapThread(t, entries);
  it('span, counts and steps', () => {
    expect(spanLabel(w.from, w.to, now)).toBe('Oct 9 – 12');
    expect([w.days, w.entries, w.voice, w.photos, w.stepsDone]).toEqual([4, 3, 1, 1, 1]);
    expect(w.openSteps).toEqual(['Send photos to Rumi']);
    expect(w.numbers[0]).toMatchObject({ metric: 'spent', total: 5000 });
  });
  it('as text', () => {
    const text = wrapText(t, w);
    expect(text).toContain('Oct 9 – 12 · 4 days · 3 notes');
    expect(text).toContain('Spent: ৳5,000');
    expect(text).toContain('Still open: Send photos to Rumi');
  });
  it('months and years apart', () => {
    const at = (d: string) => new Date(`${d}T12:00`).getTime();
    expect(spanLabel(at('2026-10-30'), at('2026-11-02'), now)).toBe('Oct 30 – Nov 2');
    expect(spanLabel(at('2025-12-28'), at('2026-01-03'), now)).toBe('Dec 28, 2025 – Jan 3, 2026');
    expect(spanLabel(at('2025-03-03'), at('2025-03-09'), now)).toBe('Mar 3 – 9, 2025');
    expect(spanLabel(at('2025-03-03'), at('2025-03-03'), now)).toBe('Mar 3, 2025');
  });
  it('open steps: next step, unticked steps and list items, once each', () => {
    const list = { kind: 'checklist', items: [{ id: '1', text: 'Buy paint', checked: false }, { id: '2', text: 'Sand', checked: true }, { id: '3', text: 'send photos to rumi', checked: false }] };
    expect(openStepsOf([entries[2], entry('d', 'trip', now, { blocks: [list] })], { nextStep: 'Pay the hotel' })).toEqual([
      'Pay the hotel',
      'Buy paint',
      'send photos to rumi',
    ]);
  });
  it('a thread with no notes', () => {
    const empty = wrapThread(thread('blank', { createdAt: now }), []);
    expect([empty.entries, empty.days, empty.openSteps.length]).toEqual([0, 1, 0]);
  });
});
