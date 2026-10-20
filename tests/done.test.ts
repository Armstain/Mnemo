import { describe, expect, it } from 'vitest';
import { celebrate, doneSummary, isRealTask, onCelebrate } from '@/lib/done';

const DAY = 24 * 60 * 60 * 1000;
const text = { kind: 'text', markdown: 'x' } as const;
const thread = (o: object = {}) => ({ type: 'note', ...o }) as never;
const entry = (o: object = {}) => ({ blocks: [text], ...o }) as never;

describe('what counts as a real task', () => {
  it('a plain note, or one with only an AI-suggested next step, is not', () => {
    expect(isRealTask(thread(), [entry()])).toBe(false);
    expect(isRealTask(thread({ nextStep: 'Look into it' }), [entry({ nextStep: 'Look into it' })])).toBe(false);
  });

  it('a reminder, a checklist, a next step written by hand, or a step ticked off makes one', () => {
    expect(isRealTask(thread({ dueDate: 1 }), [entry()])).toBe(true);
    expect(isRealTask(thread({ type: 'checklist' }), [entry()])).toBe(true);
    expect(isRealTask(thread(), [entry({ blocks: [{ kind: 'checklist', items: [] }] })])).toBe(true);
    expect(isRealTask(thread({ nextStep: 'Call him', pinned: { nextStep: true } }), [entry()])).toBe(true);
    expect(isRealTask(thread(), [entry({ stepDone: true })])).toBe(true);
  });
});

describe('the line under "Done"', () => {
  it('says how many steps and how long', () => {
    const entries = [entry({ nextStep: 'a', stepDone: true }), entry({ nextStep: 'b', stepDone: true }), entry({ nextStep: 'c' })];
    expect(doneSummary({ createdAt: 0 }, entries, 12 * DAY + 5)).toBe('2 steps · 12 days');
    expect(doneSummary({ createdAt: 0 }, [entry({ nextStep: 'a', stepDone: true })], DAY)).toBe('1 step · 1 day');
  });

  it('says nothing for something started and finished the same day', () => {
    expect(doneSummary({ createdAt: 0 }, [entry()], 3600e3)).toBe('');
  });
});

describe('announcing it', () => {
  it('reaches whoever is listening, until they stop', () => {
    const heard: string[] = [];
    const stop = onCelebrate((c) => heard.push(c.title));
    celebrate({ title: 'Passport' });
    stop();
    celebrate({ title: 'Ignored' });
    expect(heard).toEqual(['Passport']);
  });
});
