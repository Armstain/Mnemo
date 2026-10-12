import { describe, expect, it } from 'vitest';
import { reviewLine, weekReview } from '@/lib/review';
import { spanLabel, wrapText, wrapThread } from '@/lib/wrapup';

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
    expect(r.due.map((t: { id: string }) => t.id)).toEqual(['pitch']);
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
  it('one line for the notification', () => {
    expect(reviewLine(r, (t) => `${t.metric} ${t.total}`)).toBe('4 notes in 3 threads, spent 5000, 2 steps open, 1 gone quiet.');
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
    expect(spanLabel(w.from, w.to)).toBe('Oct 9 – 12');
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
  it('months apart', () => {
    expect(spanLabel(new Date('2026-10-30').getTime(), new Date('2026-11-02').getTime())).toBe('Oct 30 – Nov 2');
  });
});
