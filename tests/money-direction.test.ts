import { describe, expect, it } from 'vitest';
import { understand } from '@/lib/understand';
import { countsAsHappened, numbersToShow, summarizeMeasures, verifyMeasures } from '@/lib/measures';
import { weekReview } from '@/lib/review';
import type { Entry, Measure, MnemoItem } from '@/types/mnemo';

// Money has a direction (docs/plans/2026-11-root-fixes.md, B1). Money counts when it's paid:
// a debt is "owe", money someone owes you is "lent", a payment still to make is "planned".
// Only what happened ("spent", "received") is added up as such.

const now = new Date('2026-11-09T10:00:00').getTime();
const money = (text: string) =>
  understand(text, { now, currency: 'BDT' }).measures.map((m) => [m.metric, m.value]);

describe('what the phone reads money as', () => {
  it('the বাকি note from the screenshot is a debt, not spending', () => {
    expect(money('দোকানের ২০ টাকা বাকি আছে যা কাল রাতে দিতে হবে')).toEqual([['owe', 20]]);
  });

  it('debts: বাকি, ধার নিলাম, borrowed, owe', () => {
    expect(money('মুদি দোকানে ৩৫০ টাকা বাকি')).toEqual([['owe', 350]]);
    expect(money('karim er kache 500 taka dhar nilam')).toEqual([['owe', 500]]);
    expect(money('রহিমের থেকে ১০০০ টাকা ধার নিয়েছি')).toEqual([['owe', 1000]]);
    expect(money('borrowed 2000 taka from Sami')).toEqual([['owe', 2000]]);
    expect(money('I owe the tailor 800 taka')).toEqual([['owe', 800]]);
  });

  it('money someone owes you: ধার দিলাম, lent, পাবো, কাছে পাওনা', () => {
    expect(money('রাফিকে ৫০০ টাকা ধার দিলাম')).toEqual([['lent', 500]]);
    expect(money('lent Nadia 1500 taka')).toEqual([['lent', 1500]]);
    expect(money('Tanvir owes me 300 taka')).toEqual([['lent', 300]]);
    expect(money('রহিমের কাছে ৫০০ টাকা পাওনা')).toEqual([['lent', 500]]);
    expect(money('jamal er kache 200 taka pabo')).toEqual([['lent', 200]]);
  });

  it('a payment still to make is planned', () => {
    expect(money('need to pay rent 8000 taka on the 5th')).toEqual([['planned', 8000]]);
    expect(money('কাল বিদ্যুৎ বিল ১২০০ টাকা দিতে হবে')).toEqual([['planned', 1200]]);
    expect(money('will buy a fan for 3500 taka')).toEqual([['planned', 3500]]);
  });

  it('spending, income and prices read as before', () => {
    expect(money('spent 300 taka on lunch')).toEqual([['spent', 300]]);
    expect(money('cng khoroch gese der hajar taka')).toEqual([['spent', 1500]]);
    expect(money('paid 500 taka for fuel')).toEqual([['spent', 500]]);
    expect(money('রিকশা ভাড়া ৫০ টাকা দিলাম')).toEqual([['spent', 50]]);
    expect(money('salary 45000 taka')).toEqual([['received', 45000]]);
    expect(money('laptop price 85000 taka')).toEqual([['price', 85000]]);
  });

  it('each part of a note on its own: spent now, owed for later', () => {
    expect(money('lunch 120 taka, baki 40 taka for tea')).toEqual([
      ['spent', 120],
      ['owe', 40],
    ]);
  });

  it('paying a debt off later is spending then', () => {
    expect(money('দোকানের বাকি ২০ টাকা দিয়ে দিলাম')).toEqual([['spent', 20]]);
    expect(money('paid back the 800 I owed the tailor')).toEqual([['spent', 800]]);
  });
});

describe('what Gemini sends is kept, with the usual words for a debt mapped', () => {
  const said = 'the shop 20';
  const one = (metric: string): Measure[] => verifyMeasures([{ metric, value: 20, unit: 'BDT', rollup: 'sum' }], said);
  it('debt words become owe; a loan given becomes lent; a budget becomes planned', () => {
    expect(one('debt')[0].metric).toBe('owe');
    expect(one('borrowed')[0].metric).toBe('owe');
    expect(one('loaned')[0].metric).toBe('lent');
    expect(one('budget')[0].metric).toBe('planned');
  });
  it('a name a thread already uses is left alone', () => {
    expect(one('expense')[0].metric).toBe('expense');
    expect(one('spent')[0].metric).toBe('spent');
  });
  it('only for money: "due" in another unit is not touched', () => {
    expect(verifyMeasures([{ metric: 'debt', value: 20, unit: 'pages', rollup: 'sum' }], said)[0].metric).toBe('debt');
  });
});

describe('what counts as having happened', () => {
  it('spent and received did; owe, lent and planned are still open', () => {
    expect(['spent', 'Received', 'expense', 'ran'].map(countsAsHappened)).toEqual([true, true, true, true]);
    expect(['owe', 'lent', 'Planned'].map(countsAsHappened)).toEqual([false, false, false]);
  });
});

describe('the weekly review adds up only what happened', () => {
  const entry = (id: string, threadId: string, items: Measure[]): Entry => ({
    id,
    threadId,
    createdAt: now - 3600_000,
    updatedAt: now - 3600_000,
    source: 'text',
    blocks: [{ kind: 'measures', items }],
    filing: { by: 'user' },
  });
  const thread = (id: string): MnemoItem =>
    ({ id, title: id, type: 'note', content: '', links: [], tags: [], category: 'errands', status: 'active', createdAt: now - 3600_000, updatedAt: now - 3600_000 }) as MnemoItem;
  const bdt = (metric: string, value: number): Measure => ({ metric, value, unit: 'BDT', rollup: 'sum' });

  it('a debt this week is not "spent"; paying it is', () => {
    const r = weekReview(
      [thread('shop'), thread('lunch')],
      [entry('a', 'shop', [bdt('owe', 20)]), entry('b', 'lunch', [bdt('spent', 120)])],
      now,
    );
    expect(r.totals.map((t) => [t.metric, t.total])).toEqual([['spent', 120]]);
  });

  it('the thread itself still lists the debt while it is open', () => {
    expect(summarizeMeasures([entry('a', 'shop', [bdt('owe', 20)])]).map((s) => [s.metric, s.total])).toEqual([['owe', 20]]);
  });
});

describe('on the thread and its wrap-up card', () => {
  const s = (metric: string) => ({ metric });
  it('a debt shows while the thread is open, and not once it is done (it was paid)', () => {
    expect(numbersToShow([s('owe'), s('spent')], true).map((x) => x.metric)).toEqual(['owe', 'spent']);
    expect(numbersToShow([s('owe'), s('spent'), s('planned'), s('lent')], false).map((x) => x.metric)).toEqual(['spent']);
  });
});
